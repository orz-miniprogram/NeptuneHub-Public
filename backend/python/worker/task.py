# backend/python/worker/tasks.py

from bullmq import Worker
import os
import signal
from bson import ObjectId # Needed for MongoDB _id
from pymongo import MongoClient # Import MongoClient
import networkx as nx
from datetime import datetime, timedelta
import json # Needed for json.dumps

# Import functions and models from nlp module
from nlp.processing import ( # Import necessary functions
    classify_resource_text,
    calculate_name_semantic_similarity, # For semantic name score
    levenshteinDistance, # For Levenshtein name score (optional as a secondary factor)
    determine_vcg_prices_for_tier,
    calculate_match_score,
)
# Import loaded NLP models if needed directly in task handlers (less common if functions handle it)
# from ..nlp.models import nlp_pipeline, sentence_transformer_model # Example import


# Import constants from config
from config import MONGO_URI, MONGO_DB_NAME

# Define compatible types for easy lookup (Needed in matching logic)
compatible_types = {
    'buy': 'sell',
    'sell': 'buy',
    'rent': 'lease',
    'lease': 'rent',
}

# Define your minimum score threshold for a valid match (Needed in matching logic)
MIN_MATCH_SCORE = 5 # Adjust this value

ERRAND_FEE = 2

# Define batch size for fetching resources (Needed in matching logic)
BATCH_SIZE = 1000 # Adjust batch size based on your server's memory

# Define weight for semantic name similarity score (Needed in matching logic)
SEMANTIC_SIMILARITY_WEIGHT = 5 # Example weight for scaling semantic similarity (0-1) to points

# Define the URL of your Node.js notification endpoint
# This should be configurable (e.g., read from config)
NODEJS_NOTIFICATION_URL = 'http://localhost:5000/api/notifications/send' # Replace with your actual Node.js service URL

MIN_REQUIRED_CREDITS = 60

# Define the acceptance window duration (e.g., 1 day)
ACCEPTANCE_WINDOW_DURATION = timedelta(days=1) # Define this constant
AUTO_COMPLETE_TIME_WINDOW_HOURS = int(os.getenv('AUTO_COMPLETE_TIME_WINDOW_HOURS', 24))

# --- MongoDB Connection Setup for the Worker ---
# Connect to MongoDB once when the worker process starts
try:
    db_client = MongoClient(MONGO_URI)
    db = db_client[MONGO_DB_NAME]
    resource_collection = db.resources
    match_collection = db.matches
    users_collection = db.users
    wallets_collection = db.wallets
    errands_collection = db.errands # Used in assignErrand_job
    runner_profile_collection = db.runner_profiles # <--- NEW: Used in populate_potential_matches_job & assignErrand_job
    print(f"Worker Tasks: MongoDB connected to database '{MONGO_DB_NAME}'.")
except Exception as e:
    print(f"Worker Tasks: Failed to connect to MongoDB: {e}")
    db_client = None
    db = None
    resource_collection = None
    match_collection = None
    users_collection = None
    wallets_collection = None
    errands_collection = None
    runner_profile_collection = None
    raise # Re-raise for critical failure


# --- Define job handler for 'classifyResource' ---
async def handle_ClassifyResource_Job(job): # Renamed function
    print(f"Worker Tasks: Handling classifyResource job {job.id}")
    resource_id_str = job.data.get('resourceId') # Resource ID is passed as a string from Node.js

    if not resource_id_str:
        print(f"Worker Tasks: classifyResource job {job.id} missing resourceId.")
        return # Or raise an exception

    if db is None or resource_collection is None:
        print(f"Worker Tasks: Database not available. Cannot process classifyResource job {job.id}.")
        raise ConnectionError("Database connection not available.")


    try:
        # Convert the string ID back to MongoDB ObjectId
        resource_id = ObjectId(resource_id_str)

        # 1. Fetch resource from DB (using pymongo)
        resource_data = resource_collection.find_one({'_id': resource_id})

        if not resource_data:
            print(f"Worker Tasks: Resource {resource_id_str} not found for classification.")
            return # Or mark job as failed

        print(f"Worker Tasks: Fetched resource {resource_id_str} for classification.")

        # 2. Perform classification using the imported function
        # The classify_resource_text function in nlp/processing.py
        # will use the spaCy model loaded in nlp/models.py
        classification_results = classify_resource_text(
            resource_data.get('name'),
            resource_data.get('description')
        )

        print(f"Worker Tasks: Classification results for {resource_id_str}: {classification_results}")

        # 3. Update resource in DB (using pymongo)
        update_data = {
            'category': classification_results.get('category', resource_data.get('category')),
            'specifications': classification_results.get('specifications', resource_data.get('specifications')),
            'status': 'matching' # Set status to matching after successful classification
        }

        update_result = resource_collection.update_one({'_id': resource_id}, {'$set': update_data})

        if update_result.modified_count > 0:
            print(f"Worker Tasks: Successfully updated resource {resource_id_str} after classification. Status set to 'matching'.")
        else:
             print(f"Worker Tasks: Resource {resource_id_str} found but not modified after classification.")

        # Removed: Code to add matchResources job. Matching is triggered separately.
        print(f"Worker Tasks: Classification done for {resource_id_str}. Match job trigger skipped.")


    except Exception as e:
        print(f"Worker Tasks: Error processing classifyResource job {job.id} for resource {resource_id_str}: {e}")
        try:
             resource_collection.update_one(
                 {'_id': resource_id},
                 {'$set': {'status': 'classification_failed', 'error_message': str(e)[:255]}}
             )
             print(f"Worker Tasks: Updated resource {resource_id_str} status to 'classification_failed'.")
        except Exception as db_error:
             print(f"Worker Tasks: Failed to update resource {resource_id_str} status to 'classification_failed': {db_error}")

        raise # Re-raise to let BullMQ handle retries


# --- Define job handler for 'matchResources' ---
# This handler contains the matching logic and will be called when a 'matchResources' job is added
async def handle_MatchResources_Job(job): # Renamed function
    print(f"Worker Tasks: Handling matchResources job {job.id}")

    if db is None or resource_collection is None or match_collection is None:
         print(f"Worker Tasks: Database or collections not available. Cannot process matchResources job {job.id}.")
         raise ConnectionError("Database connection not available.")

    try:
        print("Worker Tasks: Starting batching and conflict-resolving matching process...")

        # 1. Find all distinct categories with resources in 'matching' status
        # Leveraging index on 'status' and 'category'
        distinct_categories = resource_collection.distinct('category', {'status': 'matching'})

        print(f"Worker Tasks: Found {len(distinct_categories)} distinct categories with matching resources.")

        all_potential_matches = [] # Collect potential matches from all categories


        # 2. Iterate through each category (Keep this structure)
        for category in distinct_categories:
             print(f"Worker Tasks: Processing matching resources for category: {category}")

             relevant_types = set(compatible_types.keys()).union(set(compatible_types.values()))

             # Fetch resources for this category and relevant types in batches (Keep this)
             skip = 0
             category_resources = []

             while True:
                  batch_cursor = resource_collection.find({
                       'status': 'matching',
                       'category': category,
                       'type': {'$in': list(relevant_types)}
                  }).project({ # Ensure all needed fields are projected
                      'name': 1, 'type': 1, 'category': 1, 'price': 1,
                      'specifications': 1, 'userId': 1, '_id': 1 # Include _id and userId
                  }).sort([('price', 1)]).skip(skip).limit(BATCH_SIZE)

                  batch = list(batch_cursor)

                  if not batch:
                       break

                  category_resources.extend(batch)
                  skip += len(batch)
                  print(f"Worker Tasks: Fetched batch of {len(batch)} resources for category {category}. Total fetched: {len(category_resources)}")

             print(f"Worker Tasks: Finished fetching all {len(category_resources)} matching resources for category {category}.")


             # Group fetched resources by type within this category (Keep this)
             resources_by_type = {}
             for resource in category_resources:
                 if resource['type'] not in resources_by_type:
                     resources_by_type[resource['type']] = []
                 resources_by_type[resource['type']].append(resource)


             # --- Find potential matches within this category's resources --- (Keep this structure)
             for resource_a in category_resources:
                 if resource_a['type'] not in compatible_types:
                     continue

                 compatible_type = compatible_types[resource_a['type']]
                 potential_counterparts = resources_by_type.get(compatible_type, [])


                 for resource_b in potential_counterparts:
                     if resource_b['_id'] == resource_a['_id'] or resource_b['category'] != resource_a['category']:
                         continue

                     # --- Calculate Scores (Keep this logic) ---
                     semantic_similarity = calculate_name_semantic_similarity(
                         resource_a.get('name'),
                         resource_b.get('name')
                     )
                     semantic_name_score = semantic_similarity * SEMANTIC_SIMILARITY_WEIGHT

                     name_similarity_leven = levenshteinDistance(
                         (resource_a.get('name') or '').lower(),
                         (resource_b.get('name') or '').lower()
                     )
                     levenshtein_score = 0
                     if name_similarity_leven > 0 and name_similarity_leven <= 2:
                         levenshtein_score = (2 - name_similarity_leven + 1)
                     elif name_similarity_leven == 0:
                         levenshtein_score = 3

                     name_score = semantic_name_score + levenshtein_score

                     spec_match = 0
                     specs_a = resource_a.get('specifications', {}) or {}
                     specs_b = resource_b.get('specifications', {}) or {}

                     for key in specs_a:
                         if key in specs_b:
                             # Use json.dumps for consistent comparison of potentially nested dicts/lists
                             try:
                                 if json.dumps(specs_a[key], sort_keys=True) == json.dumps(specs_b[key], sort_keys=True):
                                     spec_match += 1
                             except TypeError as e:
                                 print(f"Worker Tasks: Warning: Could not compare specifications due to TypeError: {e}. Specs A[{key}]: {specs_a[key]}, Specs B[{key}]: {specs_b[key]}")
                                 # Handle cases where specs might not be serializable (e.g., complex objects)
                                 # You might skip comparison for this key or handle differently.
                                 pass # Skip comparison for this key if not serializable


                     spec_score = spec_match * 2

                     score = name_score + spec_score

                     # --- Price Compatibility Check ---
                     priceA = resource_a.get('price')
                     priceB = resource_b.get('price')
                     typeA = resource_a.get('type')
                     typeB = resource_b.get('type')

                     isPriceCompatible = False
                     if priceA is not None and priceB is not None and isinstance(priceA, (int, float)) and isinstance(priceB, (int, float)):
                          if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
                               # resourceA is buyer, resourceB is seller
                               isPriceCompatible = priceA >= priceB + ERRAND_FEE
                          elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
                               # resourceA is seller, resourceB is buyer
                               isPriceCompatible = priceB >= priceA + ERRAND_FEE

                     if score >= MIN_MATCH_SCORE and isPriceCompatible:
                         # Store the full resource documents in the potential match for easy access later
                         all_potential_matches.append({
                             'resourceA': dict(resource_a), # Store as dict to avoid potential Mongoose object issues
                             'resourceB': dict(resource_b),
                             'score': score,
                             'priceA': priceA,
                             'priceB': priceB,
                             'typeA': typeA,
                             'typeB': typeB,
                         });


        print(f"Worker Tasks: Collected {len(all_potential_matches)} total price-compatible potential matches with score >= {MIN_MATCH_SCORE} across all categories.")


        # --- Sort all potential matches globally by score (descending) ---
        all_potential_matches.sort(key=lambda x: x['score'], reverse=True);

        print("Worker Tasks: All potential matches sorted globally by score.");

        # --- Process sorted potential matches by score tier and resolve conflicts ---
        createdMatches = []; # Collect match documents to be inserted
        resourceIdsToUpdateStatus = set(); # Track resource IDs whose status needs updating
        matchedResourceIds = set(); # Track IDs matched in this run to avoid duplicates

        # Fetch current statuses only for resources involved in potential matches
        allPotentialResourceIds = set();
        for pm in all_potential_matches:
             allPotentialResourceIds.add(str(pm['resourceA']['_id']));
             allPotentialResourceIds.add(str(pm['resourceB']['_id']));

        resources_in_potential_matches_cursor = resource_collection.find(
            { '_id': { '$in': [ObjectId(id_str) for id_str in allPotentialResourceIds] } },
            { '_id': 1, 'status': 1 }
        )
        statusMap = { str(r['_id']): r['status'] for r in resources_in_potential_matches_cursor }

        print(f"Worker Tasks: Fetched status for {len(statusMap)} resources involved in potential matches.");


        currentScoreIndex = 0
        while currentScoreIndex < len(all_potential_matches):
            currentScore = all_potential_matches[currentScoreIndex]['score'];
            tierPotentialMatches = [];

            tierIndex = currentScoreIndex;
            while tierIndex < len(all_potential_matches) and all_potential_matches[tierIndex]['score'] == currentScore:
                tierPotentialMatches.append(all_potential_matches[tierIndex]);
                tierIndex += 1

            print(f"Worker Tasks: Processing tier with score {currentScore}. Found {len(tierPotentialMatches)} potential matches in this tier.");

            # --- Filter for AVAILABLE potential matches in this tier ---
            available_tier_potential_matches = []
            for potential_match in tierPotentialMatches:
                resourceA = potential_match['resourceA']
                resourceB = potential_match['resourceB']
                resourceA_id = str(resourceA['_id'])
                resourceB_id = str(resourceB['_id'])

                isResourceAAvailable = statusMap.get(resourceA_id) == 'matching' and resourceA_id not in matchedResourceIds;
                isResourceBAvailable = statusMap.get(resourceB_id) == 'matching' and resourceB_id not in matchedResourceIds;

                if isResourceAAvailable and isResourceBAvailable:
                    available_tier_potential_matches.append(potential_match);
                else:
                      if currentScore >= MIN_MATCH_SCORE:
                          print(f"Worker Tasks: Skipping potential match in tier (Score {currentScore}) between {resourceA_id} and {resourceB_id} - unavailable or already matched (status: {statusMap.get(resourceA_id, 'unknown')}, {statusMap.get(resourceB_id, 'unknown')} | matched this run: {resourceA_id in matchedResourceIds or resourceB_id in matchedResourceIds}).");


            print(f"Worker Tasks: Found {len(available_tier_potential_matches)} AVAILABLE potential matches in this tier.");


            # --- Handle Unique High Score Match vs. VCG Tie-Breaking ---
            # A tier is a unique high score match IF:
            # 1. It's the first tier (currentScoreIndex == 0).
            # 2. There is exactly ONE available potential match in this tier.
            # 3. There are no more potential matches globally, OR the next potential match globally has a strictly lower score.
            is_unique_high_score_tier = (
                currentScoreIndex == 0 and
                len(available_tier_potential_matches) == 1 and
                (tierIndex == len(all_potential_matches) or all_potential_matches[tierIndex]['score'] < currentScore)
            )


            if is_unique_high_score_tier:
                # --- Handle Unique High Score Match ---
                print(f"Worker Tasks: Identified unique high score AVAILABLE match (Score {currentScore}). Creating pending match with suggested prices.")
                unique_match = available_tier_potential_matches[0]
                resourceA = unique_match['resourceA'] # Get resource dicts from the potential match
                resourceB = unique_match['resourceB']

                rA_id = str(resourceA['_id'])
                rB_id = str(resourceB['_id'])

                # Calculate Suggested Prices for Negotiation Phase
                suggestedPriceRequester = None
                suggestedPriceOwner = None
                originalPriceRequester = None
                originalPriceOwner = None


                # Determine requester/owner and calculate suggested prices based on types and prices
                # Use the types stored in the potential_match dict, which came from the resource docs.
                typeA = unique_match.get('typeA')
                typeB = unique_match.get('typeB')
                priceA = unique_match.get('priceA')
                priceB = unique_match.get('priceB')

                # Find the original resource documents again to get userId and potentially other original fields
                # We can use the resource dicts stored in the potential match
                resourceA_doc = unique_match['resourceA']
                resourceB_doc = unique_match['resourceB']


                if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
                    # resourceA is requester (buyer side), resourceB is owner (seller side)
                    requester_userId = resourceA_doc.get('userId')
                    owner_userId = resourceB_doc.get('userId')
                    originalPriceRequester = priceA # Buyer's original bid
                    originalPriceOwner = priceB   # Seller's original ask

                    # Calculate suggested prices
                    if originalPriceOwner is not None and isinstance(originalPriceOwner, (int, float)):
                        suggestedPriceRequester = originalPriceOwner + ERRAND_FEE

                    if originalPriceRequester is not None and isinstance(originalPriceRequester, (int, float)):
                         suggestedPriceOwner = originalPriceRequester - ERRAND_FEE


                elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
                    # resourceA is owner (seller side), resourceB is requester (buyer side)
                    owner_userId = resourceA_doc.get('userId')
                    requester_userId = resourceB_doc.get('userId')
                    originalPriceOwner = priceA   # Seller's original ask
                    originalPriceRequester = priceB # Buyer's original bid

                    # Calculate suggested prices
                    if originalPriceOwner is not None and isinstance(originalPriceOwner, (int, float)):
                        suggestedPriceRequester = originalPriceOwner + ERRAND_FEE

                    if originalPriceRequester is not None and isinstance(originalPriceRequester, (int, float)):
                        suggestedPriceOwner = originalPriceRequester - ERRAND_FEE

                else:
                     # This case should not happen for a valid compatible match filtered by price compatibility
                     print(f"Worker Tasks: Warning: Unique high score match with unexpected types during suggested price calculation: {typeA} and {typeB}. Skipping match creation.")
                     # Move to the next tier index and continue the loop
                     currentScoreIndex = tierIndex
                     continue # Skip match creation and go to next tier


                # Create the Match document dictionary for the unique high score match
                newMatch = {
                    '_id': ObjectId(), # Generate new ObjectId for MongoDB
                    'resource1': resourceA_doc.get('_id'), # Original ObjectId of resource A
                    'resource2': resourceB_doc.get('_id'), # Original ObjectId of resource B
                    'requester': requester_userId,
                    'owner': owner_userId,
                    'resource1Payment': None, # Initial price is None for pending negotiation
                    'resource2Receipt': None, # Initial price is None for pending negotiation
                    'score': currentScore, # Store the unique high score
                    'status': 'pending', # Initial status for negotiation
                    'suggestedPriceRequester': suggestedPriceRequester, # Store calculated suggested prices
                    'suggestedPriceOwner': suggestedPriceOwner,
                    'originalPriceRequester': originalPriceRequester, # Store original prices
                    'originalPriceOwner': originalPriceOwner,
                    'firstAcceptanceTime': None, # Set to null initially for negotiation
                    'requesterAcceptedSuggestedPrice': False, # Set flags to false initially
                    'ownerAcceptedSuggestedPrice': False,
                    # These original acceptance flags are not strictly needed in the simplified model,
                    # but keeping them for potential future use or if schema requires.
                    'requesterAcceptedOriginalPrice': False,
                    'ownerAcceptedOriginalPrice': False,
                    'rejectedBy': None, # Set to null initially
                    'timeoutPenaltyAppliedTo': None, # Set to null initially for timeout penalties
                    'createdAt': datetime.utcnow(), # Timestamp of match creation
                    'updatedAt': datetime.utcnow(), # Add updated at timestamp
                }

                createdMatches.append(newMatch)

                # Mark the resources in this unique match as 'matched' internally
                # This prevents them from being matched in lower score tiers in this run.
                resourceIdsToUpdateStatus.add(rA_id)
                resourceIdsToUpdateStatus.add(rB_id)
                statusMap[rA_id] = 'matched' # Update status map for subsequent availability checks
                statusMap[rB_id] = 'matched'
                matchedResourceIds.add(rA_id)
                matchedResourceIds.add(rB_id)

                print(f"Worker Tasks: Created pending match for unique high score pair {rA_id} and {rB_id} (Score {currentScore}) with suggested prices.")


            else:
                # --- Handle VCG Tie-Breaking (Multiple Available Matches or Conflicts in Tier) ---
                # This block will be executed if the tier is NOT a unique high score with one available match.
                # This includes:
                # - Tiers with score lower than the highest (if any)
                # - Tiers with the same highest score (ties)
                # - The highest score tier if it has more than one available match (conflicts at the highest score)
                print(f"Worker Tasks: Tier Score {currentScore} is not a unique high score AVAILABLE match with one available match. Applying VCG tie-breaking if available matches exist.")

                selected_matches_in_tier = [] # Matches chosen by bipartite matching for this tier

                if len(available_tier_potential_matches) > 0:
                     # --- VCG Tie-Breaking Logic (Apply Bipartite Matching) ---
                     print(f"Worker Tasks: Applying Max Weight Bipartite Matching for {len(available_tier_potential_matches)} available matches in tier with score {currentScore}.")

                     B = nx.Graph()
                     buyer_nodes_in_graph = [] # Collect buyer nodes added to graph

                     for potential_match in available_tier_potential_matches:
                         resourceA_doc = potential_match['resourceA'] # Use the stored resource dicts
                         resourceB_doc = potential_match['resourceB']
                         nodeA_id = f"resource_{str(resourceA_doc.get('_id'))}_type_{resourceA_doc.get('type')}"
                         nodeB_id = f"resource_{str(resourceB_doc.get('_id'))}_type_{resourceB_doc.get('type')}"

                         buyer_node_id = None
                         seller_node_id = None
                         buyer_price = None
                         seller_price = None

                         typeA = resourceA_doc.get('type')
                         typeB = resourceB_doc.get('type')
                         priceA = resourceA_doc.get('price')
                         priceB = resourceB_doc.get('price')


                         if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
                             buyer_node_id = nodeA_id
                             seller_node_id = nodeB_id
                             buyer_price = priceA
                             seller_price = priceB
                         elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
                             seller_node_id = nodeA_id
                             buyer_node_id = nodeB_id
                             seller_price = priceA
                             buyer_price = priceB
                         else:
                             print(f"Worker Tasks: Warning: Unexpected resource types when building graph for tier: {typeA} and {typeB}. Skipping edge.")
                             continue

                         edge_weight = 0
                         if buyer_price is not None and seller_price is not None and isinstance(buyer_price, (int, float)) and isinstance(seller_price, (int, float)):
                             edge_weight = buyer_price - seller_price

                         if edge_weight > 0:
                              B.add_edge(buyer_node_id, seller_node_id, weight=edge_weight, potential_match=potential_match)
                              if buyer_node_id not in buyer_nodes_in_graph:
                                   buyer_nodes_in_graph.append(buyer_node_id)


                     if B.number_of_edges() > 0:
                         try:
                              matching_result_dict = nx.max_weight_matching(B, top_nodes=buyer_nodes_in_graph, maxcardinality=False)

                              for node1_id, node2_id in matching_result_dict.items():
                                  if B.has_edge(node1_id, node2_id):
                                       edge_data = B.get_edge_data(node1_id, node2_id)
                                       if 'potential_match' in edge_data:
                                           selected_matches_in_tier.append(edge_data['potential_match'])
                                  elif B.has_edge(node2_id, node1_id):
                                       edge_data = B.get_edge_data(node2_id, node1_id)
                                       if 'potential_match' in edge_data:
                                           selected_matches_in_tier.append(edge_data['potential_match'])
                                  else:
                                       print(f"Worker Tasks: Warning: Matched nodes {node1_id} and {node2_id} do not have a corresponding edge in the graph. Skipping.")


                              print(f"Worker Tasks: Selected {len(selected_matches_in_tier)} matches from tier score {currentScore} via Bipartite Matching (Selection).")


                              # --- Create Match Documents for the selected VCG matches ---
                              # For VCG selected matches, the VCG determined price is the initial proposal.
                              # Suggested prices can be set to these VCG prices.

                              # First, determine VCG prices for the selected matches.
                              matches_with_vcg_prices = determine_vcg_prices_for_tier(
                                 selected_matches=selected_matches_in_tier,
                                 all_available_tier_matches=available_tier_potential_matches # Pass the full list
                              )

                              for matchToCreate in matches_with_vcg_prices:
                                  resourceA_doc = matchToCreate['resourceA']
                                  resourceB_doc = matchToCreate['resourceB']

                                  rA_id = str(resourceA_doc.get('_id'))
                                  rB_id = str(resourceB_doc.get('_id'))

                                  # Check if resources are still available (should be if selected by bipartite matching from available)
                                  if statusMap.get(rA_id) == 'matching' and rA_id not in matchedResourceIds and \
                                      statusMap.get(rB_id) == 'matching' and rB_id not in matchedResourceIds:

                                      print(f"Worker Tasks: Creating match with score {matchToCreate['score']} (Tier Score) between {rA_id} and {rB_id} with VCG-determined prices.")

                                      isResourceARequester = resourceA_doc.get('type') in ['buy', 'lease', 'service-request']
                                      requesterResource = resourceA_doc if isResourceARequester else resourceB_doc
                                      ownerResource = resourceA_doc if not isResourceARequester else resourceB_doc

                                      vcg_determined_price_requester = matchToCreate['determinedPriceA'] if isResourceARequester else matchToCreate['determinedPriceB']
                                      vcg_determined_price_owner = matchToCreate['determinedPriceB'] if isResourceARequester else matchToCreate['determinedPriceA']


                                      newMatch = {
                                        '_id': ObjectId(),
                                        'resource1': requesterResource.get('_id'),
                                        'resource2': ownerResource.get('_id'),
                                        'requester': requesterResource.get('userId'),
                                        'owner': ownerResource.get('userId'),
                                        'resource1Payment': None, # Initial price is None for pending
                                        'resource2Receipt': None, # Initial price is None for pending
                                        'score': matchToCreate['score'],
                                        'status': 'pending',
                                        # For VCG matches, the suggested prices are the VCG-determined ones.
                                        'suggestedPriceRequester': vcg_determined_price_requester,
                                        'suggestedPriceOwner': vcg_determined_price_owner,
                                        'originalPriceRequester': requesterResource.get('price'), # Still store original
                                        'originalPriceOwner': ownerResource.get('price'),
                                        'firstAcceptanceTime': None, # Initial state
                                        'requesterAcceptedSuggestedPrice': False,
                                        'ownerAcceptedSuggestedPrice': False,
                                        'requesterAcceptedOriginalPrice': False, # Not used in this simplified model
                                        'ownerAcceptedOriginalPrice': False, # Not used in this simplified model
                                        'rejectedBy': None,
                                        'timeoutPenaltyAppliedTo': None,
                                        'createdAt': datetime.utcnow(),
                                        'updatedAt': datetime.utcnow(),
                                      }

                                      createdMatches.append(newMatch)

                                      resourceIdsToUpdateStatus.add(rA_id)
                                      resourceIdsToUpdateStatus.add(rB_id)
                                      statusMap[rA_id] = 'matched'
                                      statusMap[rB_id] = 'matched'
                                      matchedResourceIds.add(rA_id)
                                      matchedResourceIds.add(rB_id)

                                      print(f"Worker Tasks: Created pending VCG match for pair {rA_id} and {rB_id} with VCG-determined prices.")

                                  else:
                                      print(f"Worker Tasks: Skipping match creation for VCG pair {rA_id} and {rB_id} (Score {currentScore}) - already matched in a higher-priority tier or earlier in this run.")


                         except nx.NetworkXPointlessConcept:
                              print(f"Worker Tasks: Bipartite graph for tier score {currentScore} is empty or has no edges with positive weight. No VCG matches selected.")
                         except Exception as graph_matching_error:
                              print(f"Worker Tasks: Error during VCG Bipartite Matching for tier score {currentScore}: {graph_matching_error}")
                              pass # Continue to next tier


            # Move index to the start of the next score tier
            currentScoreIndex = tierIndex;


        # --- Save Created Match Documents and Update Statuses ---
        if createdMatches:
            try:
                insert_result = match_collection.insert_many(createdMatches)
                print(f"Worker Tasks: Successfully inserted {len(insert_result.inserted_ids)} match documents.")
            except Exception as db_error:
                print(f"Worker Tasks: Error inserting match documents: {db_error}")

        if resourceIdsToUpdateStatus:
            try:
                object_ids_to_update = [ObjectId(id_str) for id_str in resourceIdsToUpdateStatus]
                update_result = resource_collection.update_many(
                    {'_id': {'$in': object_ids_to_update}},
                    {'$set': {'status': 'matched'}} # Assuming 'matched' is a valid status
                )
                print(f"Worker Tasks: Successfully updated status to 'matched' for {update_result.modified_count} resources.")
            except Exception as db_error:
                print(f"Worker Tasks: Error updating resource statuses: {db_error}")

        print("Worker Tasks: Batching and conflict-resolving matching process finished.")

    except Exception as main_process_error:
        print(f"Worker Tasks: Error in main matchResources job process: {main_process_error}")
        # Decide how to handle critical errors in the main process.
        # Maybe log and let the job fail for BullMQ to retry.
        raise # Re-raise the exception to indicate job failure

# Note: Remember to implement the Node.js backend endpoints for negotiation
# and the Python background task for timeouts and penalties.
# Note: Ensure you have datetime imported for timestamps if you add them.
# from datetime import datetime
# Ensure ObjectId is imported from bson if you are using it.
# from bson import ObjectId

# Assuming necessary imports and DB connections

# Assuming MIN_REQUIRED_CREDITS is defined

# --- NEW: populate_potential_matches_job handler ---
async def populate_potential_matches_job(job):
    """
    BullMQ job handler to calculate match scores between service-requests and service-offers,
    and populate the potentialErrandRequests array in RunnerProfile documents.
    This job is expected to run frequently, perhaps every minute or few minutes.
    """
    job_data = job.data
    print(f"Processing populate_potential_matches_job for job ID: {job.id}, Data: {job_data}")

    if not db_client or not db:
        print("MongoDB connection not established. Exiting job.")
        # Consider raising an exception here if DB connection is critical for this job to prevent it from being marked as 'completed'
        raise ConnectionError("MongoDB client is not initialized. Cannot perform populate_potential_matches_job.")

    try:
        # Define a time window for fetching recently updated resources
        # This prevents re-processing all resources on every run.
        time_window = datetime.utcnow() - timedelta(minutes=10) # Use UTC for consistency

        # 1. Fetch relevant 'service-request' resources
        service_requests_cursor = resource_collection.find(
            {
                'type': 'service-request',
                'status': {'$in': ['submitted', 'matching']},
                'assignedErrandId': {'$exists': False},
                '$or': [
                    {'createdAt': {'$gte': time_window}},
                    {'updatedAt': {'$gte': time_window}}
                ]
            }
        ).limit(BATCH_SIZE)
        service_requests = list(service_requests_cursor)
        print(f"Found {len(service_requests)} relevant 'service-request' resources to evaluate.")

        # 2. Fetch relevant 'service-offer' resources and their associated RunnerProfiles
        service_offers_cursor = resource_collection.find(
            {
                'type': 'service-offer',
                'status': {'$in': ['active', 'available']},
                '$or': [
                    {'createdAt': {'$gte': time_window}},
                    {'updatedAt': {'$gte': time_window}}
                ]
            }
        ).limit(BATCH_SIZE)
        service_offers = list(service_offers_cursor)
        print(f"Found {len(service_offers)} relevant 'service-offer' resources.")

        # Map service offers to their associated runner profiles for efficient lookup
        runner_profile_map = {}
        if service_offers:
            runner_ids = [offer['userId'] for offer in service_offers]
            runner_profiles_cursor = runner_profile_collection.find({'userId': {'$in': runner_ids}})
            for profile in runner_profiles_cursor:
                runner_profile_map[profile['userId']] = profile

        print(f"Fetched {len(runner_profile_map)} runner profiles for active offers.")

        # 3. Iterate and Score
        # For robust array updates in MongoDB (update or push),
        # it's often more reliable to use two operations or a complex aggregation pipeline update.
        # For many updates, `bulk_write` is best.
        
        updates_queue = []

        for s_req in service_requests:
            for s_offer in service_offers:
                if s_offer['userId'] in runner_profile_map:
                    runner_profile_doc = runner_profile_map[s_offer['userId']]

                    score = calculate_match_score(s_req, s_offer, runner_profile_doc)

                    if score >= MIN_MATCH_SCORE:
                        potential_match_entry = {
                            'requestId': s_req['_id'],
                            'score': score,
                            'matchedAt': datetime.utcnow(), # Use UTC
                            'offerId': s_offer['_id']
                        }

                        # Try to update an existing entry first (using arrayFilters)
                        updates_queue.append(
                            {
                                'filter': {'_id': runner_profile_doc['_id'], 'potentialErrandRequests.requestId': s_req['_id']},
                                'update': {'$set': {'potentialErrandRequests.$[elem]': potential_match_entry}},
                                'array_filters': [{'elem.requestId': s_req['_id']}]
                            }
                        )
                        # If the above didn't update (no matching requestId found in array), push a new one
                        updates_queue.append(
                            {
                                'filter': {'_id': runner_profile_doc['_id'], 'potentialErrandRequests.requestId': {'$ne': s_req['_id']}},
                                'update': {'$push': {'potentialErrandRequests': potential_match_entry}}
                            }
                        )
                        print(f"Calculated score {score} for request {s_req['_id']} with offer {s_offer['_id']}.")
        
        # Execute bulk write operations
        if updates_queue:
            # PyMongo's bulk_write expects a list of WriteModel operations (e.g., UpdateOne)
            from pymongo import UpdateOne
            bulk_operations = []
            for op in updates_queue:
                if 'array_filters' in op:
                    bulk_operations.append(UpdateOne(op['filter'], op['update'], array_filters=op['array_filters']))
                else:
                    bulk_operations.append(UpdateOne(op['filter'], op['update']))
            
            if bulk_operations:
                try:
                    result = await asyncio.to_thread(runner_profile_collection.bulk_write, bulk_operations) # Run blocking DB call in a thread
                    print(f"Bulk write for runner profiles completed. Upserted: {result.upserted_count}, Matched: {result.matched_count}, Modified: {result.modified_count}")
                except Exception as e_bulk:
                    print(f"Error during bulk write for runner profiles: {e_bulk}")
        
        print("Finished calculating and updating potential matches.")

    except Exception as e_job:
        print(f"An unhandled error occurred in populate_potential_matches_job: {e_job}")
        raise # Re-raise for BullMQ retry

    print(f"Finished populate_potential_matches_job for job ID: {job.id}")


# --- NEW: assignErrand_job handler ---
async def assignErrand_job(job):
    """
    BullMQ job handler to find and assign runners to pending service-request resources.
    This job is expected to run periodically.
    """
    job_data = job.data
    print(f"Processing assignErrand_job for job ID: {job.id}, Data: {job_data}")

    if not db_client or not db:
        print("MongoDB connection not established. Exiting job.")
        raise ConnectionError("MongoDB client is not initialized. Cannot perform assignErrand_job.")

    try:
        # 1. Identify Pending 'service-request' Resources
        pending_service_requests_cursor = resource_collection.find(
            {
                'type': 'service-request',
                'status': 'matching', # Status indicates it's waiting for an assignment
                'assignedErrandId': {'$exists': False}
            }
        ).sort('createdAt', 1).limit(BATCH_SIZE)

        pending_service_requests = list(pending_service_requests_cursor)

        if not pending_service_requests:
            print("No pending 'service-request' resources found for assignment.")
            return

        print(f"Found {len(pending_service_requests)} pending 'service-request' resources.")

        # Process each service-request one by one
        for s_req_resource in pending_service_requests:
            resource_id = s_req_resource['_id']
            requester_id = s_req_resource['userId']
            resource_specs = s_req_resource.get('specifications', {})
            resource_name = s_req_resource.get('name', f"Errand Request {resource_id}")

            print(f"\n--- Processing service-request: {resource_id} ---")

            # 2. Find Best Potential Runner for this Service Request
            potential_runners_cursor = runner_profile_collection.find(
                {
                    'potentialErrandRequests.requestId': resource_id,
                    # Add conditions for runner availability (e.g., 'isAvailable': True)
                    # 'isAvailable': True # Example, uncomment and define if applicable
                    'currentActiveErrand': {'$exists': False} # Example: runner is not currently on an active errand
                }
            )
            potential_runners_list = list(potential_runners_cursor)

            if not potential_runners_list:
                print(f"No potential runners found for service-request: {resource_id}.")
                resource_collection.update_one(
                    {'_id': resource_id},
                    {'$inc': {'matchAttempts': 1}}
                )
                continue

            scored_runners = []
            for runner_profile in potential_runners_list:
                for req_entry in runner_profile.get('potentialErrandRequests', []):
                    if req_entry['requestId'] == resource_id:
                        score = req_entry.get('score', 0)
                        if not isinstance(score, (int, float)):
                            score = 0
                        matched_at = req_entry.get('matchedAt', datetime.min)
                        scored_runners.append({
                            'runner_profile': runner_profile,
                            'score': score,
                            'matchedAt': matched_at
                        })
                        break

            eligible_runners = [r for r in scored_runners if r['score'] >= MIN_MATCH_SCORE]

            if not eligible_runners:
                print(f"No eligible runners (score >= {MIN_MATCH_SCORE}) found for service-request: {resource_id}.")
                resource_collection.update_one(
                    {'_id': resource_id},
                    {'$inc': {'matchAttempts': 1}}
                )
                continue

            # Sort eligible runners: highest score first, then oldest matched time first
            eligible_runners.sort(key=lambda x: (x['score'], x['matchedAt']), reverse=True)

            best_runner_entry = eligible_runners[0]
            best_runner_profile = best_runner_entry['runner_profile']
            assigned_runner_id = best_runner_profile['userId']

            print(f"Identified best runner {assigned_runner_id} (profile ID: {best_runner_profile['_id']}) for service-request {resource_id}.")

            # 3. Create New Errand Document and update related documents in a transaction
            # This ensures atomicity for the critical assignment process.
            with db_client.start_session() as session:
                with session.start_transaction():
                    try:
                        new_errand_doc = {
                            'resourceRequestId': resource_id,
                            'currentStatus': 'pending',
                            'errandRunner': assigned_runner_id,
                            'runnerAssignedAt': datetime.utcnow(), # Use UTC

                            'pickupLocation': resource_specs.get('from_address', {}),
                            'dropoffLocation': resource_specs.get('to_address', {}),
                            'isDeliveryToDoor': resource_specs.get('door_delivery', False),
                            'deliveryFee': float(s_req_resource.get('price', 0)) if s_req_resource.get('price') is not None else 0,
                            'doorDeliveryUnits': int(resource_specs.get('door_delivery_units', 0)) if resource_specs.get('door_delivery_units') is not None else 0,
                            'expectedStartTime': resource_specs.get('expectedStartTime'),
                            'expectedEndTime': resource_specs.get('expectedEndTime'),
                            'expectedTimeframeString': resource_specs.get('expectedTimeframeString'),

                            'createdAt': datetime.utcnow(), # Use UTC
                            'updatedAt': datetime.utcnow(), # Use UTC
                        }

                        if not isinstance(new_errand_doc['resourceRequestId'], ObjectId):
                            new_errand_doc['resourceRequestId'] = ObjectId(new_errand_doc['resourceRequestId'])
                        if not isinstance(new_errand_doc['errandRunner'], ObjectId):
                            new_errand_doc['errandRunner'] = ObjectId(new_errand_doc['errandRunner'])

                        insert_result = await asyncio.to_thread(errands_collection.insert_one, new_errand_doc, session=session)
                        new_errand_id = insert_result.inserted_id
                        print(f"Successfully created new Errand document: {new_errand_id} for service-request {resource_id}.")

                        # 4. Update 'service-request' Resource
                        await asyncio.to_thread(
                            resource_collection.update_one,
                            {'_id': resource_id},
                            {
                                '$set': {
                                    'status': 'matched',
                                    'assignedErrandId': new_errand_id
                                },
                                '$inc': {'matchAttempts': 1}
                            },
                            session=session
                        )
                        print(f"Updated service-request {resource_id} status to 'matched' and linked to Errand {new_errand_id}.")

                        # 5. Update RunnerProfile (Remove assigned request from potential matches & set current active errand)
                        await asyncio.to_thread(
                            runner_profile_collection.update_one,
                            {'_id': best_runner_profile['_id']},
                            {
                                '$pull': {'potentialErrandRequests': {'requestId': resource_id}},
                                '$set': {'currentActiveErrand': new_errand_id} # Assign the errand to runner
                            },
                            session=session
                        )
                        print(f"Removed service-request {resource_id} from runner {best_runner_profile['_id']}'s potential matches and assigned new errand.")

                        # 6. Send Notification to Runner (via Node.js service)
                        try:
                            notification_payload = {
                                'userId': str(assigned_runner_id),
                                'message': f"You have been assigned a new errand: '{resource_name}'. Please accept to confirm.",
                                'data': {
                                    'errandId': str(new_errand_id),
                                    'resourceId': str(resource_id),
                                    'type': 'errand_assignment',
                                    'resourceName': resource_name,
                                    'pickupLocation': resource_specs.get('from_address', {}).get('full_address', 'N/A'),
                                    'dropoffLocation': resource_specs.get('to_address', {}).get('full_address', 'N/A'),
                                    'deliveryTime': resource_specs.get('delivery_time', 'N/A')
                                }
                            }
                            headers = {'Content-Type': 'application/json'}
                            # Perform the HTTP request in a separate thread to avoid blocking the event loop
                            await asyncio.to_thread(
                                requests.post,
                                NODEJS_NOTIFICATION_URL,
                                data=json.dumps(notification_payload),
                                headers=headers,
                                timeout=5
                            )
                            print(f"Notification sent successfully to runner {assigned_runner_id}.")
                        except requests.exceptions.RequestException as req_e:
                            print(f"Failed to send notification to runner {assigned_runner_id}: {req_e}")
                        except Exception as notif_e:
                            print(f"An unexpected error occurred while sending notification: {notif_e}")

                        session.commit_transaction() # Commit the transaction on success
                        print(f"Transaction committed for service-request {resource_id}.")

                    except Exception as e_transaction:
                        session.abort_transaction() # Rollback on error
                        print(f"Error during transaction for service-request {resource_id}: {e_transaction}. Transaction aborted.")
                        job.log(f"Transaction error for resource {resource_id}: {e_transaction}")
                        # Optionally increment matchAttempts here, or rely on subsequent job runs
                        await asyncio.to_thread(
                            resource_collection.update_one,
                            {'_id': resource_id},
                            {'$inc': {'matchAttempts': 1}}
                        )
                        # Do not re-raise here, so job doesn't necessarily fail for one resource.
                        # However, if you want the job to retry the *entire batch*, re-raise after rollback.
                        # For now, we'll log and continue.
            
    except Exception as e_job:
        print(f"An unhandled error occurred in assignErrand_job: {e_job}")
        raise # Re-raise for BullMQ retry

    print(f"Finished assignErrand_job for job ID: {job.id}")


# --- Separate Process/Endpoint for Requester Acceptance ---
# This is an API endpoint triggered by the frontend when the requester accepts an offer resource.
# async def handle_AcceptOfferResource_Request(errandRequestId, acceptedOfferResourceId, userId):
#     # 1. Verify user is the requester of the errandRequestId
#     # 2. Find the Errand-Request Resource ('service-request') and the Accepted Offer Resource ('service-offer')
#     # 3. Check statuses (Request: 'offers_received', Accepted Offer: 'pending_offer')
#     # 4. Check if the Accepted Offer Resource is actually linked to the Request Resource using offersToResourceId
#     # 5. Find the associated Errand document (if you have one linked to the request resource or match)
#     # 6. Update the Errand-Request Resource status (e.g., 'assigned' or 'matched_with_offer')
#     # 7. Update the Accepted Offer Resource's status to 'offer_accepted'
#     # 8. Find all OTHER pending offer resources for this errand-request and update their status to 'offer_rejected'
#     # 9. If using a separate Errand document, update it: set errandRunner, currentStatus to 'assigned', runnerAssignedAt, and link it to the accepted offer resource ID?
#     # 10. Notify the assigned runner (the userId from the accepted offer resource)
#     # 11. Notify other offering runners their offers were rejected
#     pass # This is a separate flow triggered by user action

# --- Define job handler for 'cleanupTimedOutMatches' ---
# This job will be scheduled to run periodically to clean up timed-out matches.
async def handle_CleanupTimedOutMatches_Job(job):
    print(f"Worker Tasks: Handling cleanupTimedOutMatches job {job.id}")

    # Ensure database connections are available
    if db is None or match_collection is None or db.users is None:
        print(f"Worker Tasks: Database or collections not available. Cannot process cleanupTimedOutMatches job {job.id}.")
        # Depending on your setup, you might raise an exception or return
        # If using BullMQ, raising an exception allows it to retry the job
        raise ConnectionError("Database connection not available.")

    try:
        print("Worker Tasks: Starting cleanup process for timed-out pending matches...")

        # --- 1. Handle Matches that Timed Out in the Acceptance Window ---
        # These are matches where the first user accepted suggested, but the second didn't within 1 day.
        # Query: status is 'pending', firstAcceptanceTime is NOT null, and firstAcceptanceTime is older than (now - 1 day)
        acceptance_window_timeout_threshold = datetime.utcnow() - ACCEPTANCE_WINDOW_DURATION

        timed_out_acceptance_matches_cursor = match_collection.find({
            'status': 'pending',
            'firstAcceptanceTime': {'$ne': None, '$lt': acceptance_window_timeout_threshold}
            # The query uses the index on status and firstAcceptanceTime for efficiency
        })

        timed_out_acceptance_matches = list(timed_out_acceptance_matches_cursor)

        print(f"Worker Tasks: Found {len(timed_out_acceptance_matches)} timed-out matches from the Acceptance Window.")

        if timed_out_acceptance_matches:
            for match in timed_out_acceptance_matches:
                match_id = str(match['_id'])
                print(f"Worker Tasks: Processing Acceptance Window timed-out match {match_id}")

                try: # This is the inner try-except for processing each match
                    # 1. Update Match Status to 'cancelled'
                    update_result = match_collection.update_one(
                        {'_id': match['_id'], 'status': 'pending'},  # Only update if status is still pending
                        {'$set': {
                            'status': 'cancelled',
                            'cancellationReason': 'Acceptance window expired',  # Add a reason
                            'updatedAt': datetime.utcnow()  # Update timestamp
                        }}
                    )

                    if update_result.modified_count > 0:
                        print(f"Worker Tasks: Match {match_id} status updated to 'cancelled' due to Acceptance Window timeout.")

                        # 2. Determine the user who timed out and apply penalty
                        timed_out_user_id = None
                        # Convert to bool explicitly as they might be stored as None or other falsy values
                        requester_accepted = bool(match.get('requesterAcceptedSuggestedPrice'))
                        owner_accepted = bool(match.get('ownerAcceptedSuggestedPrice'))

                        if not requester_accepted: # Requester did not accept
                            timed_out_user_id = match.get('requester')
                        elif not owner_accepted: # Owner did not accept (assuming requester accepted)
                            timed_out_user_id = match.get('owner')
                        # If both are true, status should not have been pending - a safeguard check
                        elif match.get('requesterAcceptedSuggestedPrice') is True and match.get('ownerAcceptedSuggestedPrice') is True:
                            print(f"Worker Tasks: Warning: Match {match_id} found in pending state but both accepted flags are true. Status will be set to cancelled, but penalty logic might need review.")
                            # In this case, maybe no penalty, or investigate why status wasn't updated earlier.
                            pass  # No timed_out_user_id in this case
                        else:
                            # Should not happen if flags are boolean
                            print(f"Worker Tasks: Warning: Could not determine timed-out user for match {match_id}. Flags: Req: {match.get('requesterAcceptedSuggestedPrice')}, Owner: {match.get('ownerAcceptedSuggestedPrice')}. Skipping penalty.")

                        if timed_out_user_id:
                            print(f"Worker Tasks: User {timed_out_user_id} timed out on match {match_id} in Acceptance Window. Applying penalty.")
                            # Update the match document to record who received the penalty
                            match_collection.update_one(
                                {'_id': match['_id']},
                                {'$set': {'timeoutPenaltyAppliedTo': timed_out_user_id, 'updatedAt': datetime.utcnow()}}
                            )

                            # Apply the penalty (deduct 5 points) to the user's points
                            user_collection = db.users  # Assuming your User collection is accessible
                            user_update_result = user_collection.update_one(
                                {'_id': timed_out_user_id},
                                {'$inc': {'points': -5}}  # Deduct 5 points
                            )

                            if user_update_result.modified_count > 0:
                                print(f"Worker Tasks: Successfully deducted 5 points from user {timed_out_user_id}.")
                            else:
                                print(f"Worker Tasks: User {timed_out_user_id} not found or not modified for penalty.")

                            # 3. Notify users about the timeout and cancellation (Implement this logic)
                            # Example: Notify users about a match timeout
                            requester_id = str(match.get('requester'))  # Ensure IDs are strings for JSON
                            owner_id = str(match.get('owner'))
                            match_id = str(match.get('_id'))

                            notification_payload = {
                                'recipientUserIds': [requester_id, owner_id],
                                'messageKey': 'match_timed_out_penalty',  # A key to identify the message type
                                'data': {
                                    'matchId': match_id,
                                    'timedOutUserId': str(timed_out_user_id) if timed_out_user_id else None,
                                    # Include any other data needed for the notification message
                                }
                            }

                            try:
                                # Make the HTTP POST request to the Node.js notification endpoint
                                response = requests.post(NODEJS_NOTIFICATION_URL, json=notification_payload)
                                response.raise_for_status()  # Raise an exception for bad status codes (4xx or 5xx)
                                print(f"Worker Tasks: Successfully requested notification for match {match_id}.")
                            except requests.exceptions.RequestException as e:
                                print(f"Worker Tasks: Error requesting notification for match {match_id}: {e}")
                                # Decide how to handle notification request failures (log, retry the worker job?)
                            except Exception as notify_error:
                                print(f"Worker Tasks: Unexpected error during notification for match {match_id}: {notify_error}")

                    else:
                        print(f"Worker Tasks: Match {match_id} was not in 'pending' status when cleanup tried to cancel it (already handled?). Skipping penalty/notification for this match in cleanup.")

                except Exception as process_match_error: # This catches errors during the processing of a single match
                    print(f"Worker Tasks: Error processing timed-out match {match_id}: {process_match_error}")
                    # Log the error and continue with the next match

        # --- 2. Handle Matches that Timed Out in the Initial Pending Window (No action taken) ---
        # These are matches where no one accepted or rejected within 1 day of creation.
        # Query: status is 'pending', firstAcceptanceTime is null, and createdAt is older than (now - 1 day)
        initial_pending_timeout_threshold = datetime.utcnow() - ACCEPTANCE_WINDOW_DURATION  # Using same 1 day duration

        timed_out_initial_pending_matches_cursor = match_collection.find({
            'status': 'pending',
            'firstAcceptanceTime': None,  # Check for null
            'createdAt': {'$lt': initial_pending_timeout_threshold}
            # Also check that rejection hasn't happened? If status is pending, it shouldn't have been rejected.
        })

        timed_out_initial_pending_matches = list(timed_out_initial_pending_matches_cursor)

        print(f"Worker Tasks: Found {len(timed_out_initial_pending_matches)} timed-out matches from the Initial Pending Window (no action).")

        if timed_out_initial_pending_matches:
            for match in timed_out_initial_pending_matches:
                match_id = str(match['_id'])
                print(f"Worker Tasks: Processing Initial Pending Window timed-out match {match_id}")

                try:
                    # Update Match Status to 'cancelled'
                    # Use update_one with status check for safety
                    update_result = match_collection.update_one(
                        {'_id': match['_id'], 'status': 'pending'},  # Only update if status is still pending
                        {'$set': {
                            'status': 'cancelled',
                            'cancellationReason': 'Initial pending window expired (no action taken)',  # Add a reason
                            'updatedAt': datetime.utcnow()  # Update timestamp
                        }}
                    )

                    if update_result.modified_count > 0:
                        print(f"Worker Tasks: Match {match_id} status updated to 'cancelled' due to Initial Pending timeout.")
                        # No penalty in this case based on client's input (penalty for timeout user who failed to accept).
                        # Notify users that the match was cancelled due to no action.
                        requester_id = str(match.get('requester'))
                        owner_id = str(match.get('owner'))
                        notification_payload = {
                            'recipientUserIds': [requester_id, owner_id],
                            'messageKey': 'match_cancelled_no_action',
                            'data': {'matchId': match_id}
                        }
                        try:
                            response = requests.post(NODEJS_NOTIFICATION_URL, json=notification_payload)
                            response.raise_for_status()
                            print(f"Worker Tasks: Successfully requested notification for match {match_id} (no action).")
                        except requests.exceptions.RequestException as e:
                            print(f"Worker Tasks: Error requesting notification for match {match_id} (no action): {e}")
                        except Exception as notify_error:
                            print(f"Worker Tasks: Unexpected error during notification (no action) for match {match_id}: {notify_error}")

                    else:
                        print(f"Worker Tasks: Match {match_id} was not in 'pending' status when cleanup tried to cancel it (already handled?). Skipping notification for this match.")

                except Exception as process_match_error:
                    print(f"Worker Tasks: Error processing Initial Pending timed-out match {match_id}: {process_match_error}")
                    # Log the error and continue

        print("Worker Tasks: Cleanup process for timed-out pending matches finished.")

    except Exception as main_cleanup_error:
        print(f"Worker Tasks: Error in main cleanupTimedOutMatches job process: {main_cleanup_error}")
        # Log the error and let the job fail for BullMQ to handle retries
        raise  # Re-raise the exception

      # --- Helper function for match completion logic (adapted from Node.js) ---
async def _process_match_completion(match_id: ObjectId, session=None):
    """
    Handles the logic to complete a match, credit owner's wallet, and award points/credits.
    This function is designed to be called within a MongoDB transaction.
    """
    print(f"Attempting auto-completion for match {match_id}...")

    # Use the correctly named collection 'match_collection'
    match = match_collection.find_one({'_id': match_id}, session=session)
    if not match:
        print(f"Match {match_id} not found during auto-completion process.")
        return False

    # If the match is already completed, skip processing to ensure idempotency
    if match.get('status') == 'completed':
        print(f"Match {match_id} already completed. Skipping auto-completion.")
        return False

    if not match.get('owner'):
        print(f"Match {match_id} has no owner. Skipping auto-completion.")
        return False

    # 1. Credit Owner's Wallet
    owner_id = match['owner']
    final_amount = match.get('finalAmount')

    if not isinstance(final_amount, (int, float)) or final_amount <= 0:
        print(f"Match {match_id} has invalid finalAmount: {final_amount}. Cannot credit wallet.")
        raise ValueError("Invalid finalAmount for wallet credit.")

    # Ensure wallet exists and update using correct collection name
    wallet_update_result = wallets_collection.update_one(
        {'userId': owner_id},
        {
            '$inc': {'balance': final_amount},
            '$push': {
                'transactions': {
                    'type': 'credit',
                    'amount': final_amount,
                    'description': f'Earnings from Auto-Completed Match (ID: {match_id})',
                    'referenceId': match_id,
                    'referenceModel': 'Match',
                    'status': 'completed',
                    'transactionFee': 0,
                    'processedBy': 'System',
                    'createdAt': datetime.utcnow(),
                    'updatedAt': datetime.utcnow()
                }
            },
            '$set': {'updatedAt': datetime.utcnow()}
        },
        session=session
    )
    if wallet_update_result.matched_count == 0:
        raise ValueError(f"Wallet not found or unable to update for owner {owner_id} during auto-completion.")
    print(f"Credited wallet for owner {owner_id} with RM {final_amount:.2f} for match {match_id}.") # Format to 2 decimal places

    # 2. Award Points & Credits to the Owner
    # Fetch the owner's user document directly (assuming it's found and updated in place)
    # Need to get the current points/credits before updating
    owner_user = users_collection.find_one({'_id': owner_id}, session=session)
    if not owner_user:
        raise ValueError(f"Owner user {owner_id} not found for awarding points/credits during auto-completion.")

    points_earned = int(final_amount) # 1 point per RM 1, rounded down
    if points_earned > 0:
        owner_user['points'] = owner_user.get('points', 0) + points_earned # Use .get() for safe access
        print(f"User {owner_id} earned {points_earned} points for match {match_id}. New points: {owner_user['points']}.")

    credits_awarded = 0
    if owner_user.get('credits', 0) < 100: # Use .get() for safe access and check max cap
        owner_user['credits'] = owner_user.get('credits', 0) + 1
        credits_awarded = 1
        print(f"User {owner_id} earned 1 credit for match {match_id}. New credits: {owner_user['credits']}.")
    else:
        print(f"User {owner_id} has maxed out credits (100). No credit awarded for match {match_id}.")

    # Update the user document in the database
    users_collection.update_one(
        {'_id': owner_id},
        {
            '$set': {
                'points': owner_user['points'],
                'credits': owner_user['credits'],
                'updatedAt': datetime.utcnow()
            }
        },
        session=session
    )
    
    # 3. Update Match Status
    match_collection.update_one(
        {'_id': match_id},
        {
            '$set': {
                'status': 'completed',
                'updatedAt': datetime.utcnow()
            }
        },
        session=session
    )
    print(f"Match {match_id} status updated to 'completed'.")

    return True

# --- Main job processing function ---
async def handle_AutoCompleteMatch_Job(job):
    print(f"Processing job {job.id} of type {job.name} with data: {job.data}")

    auto_complete_threshold = datetime.utcnow() - timedelta(hours=AUTO_COMPLETE_TIME_WINDOW_HOURS)

    # Simplified query based on user request: only check for completedAt older than threshold
    pipeline = [
        {
            '$match': {
                'status': 'erranding' # Still good to filter for matches that are in 'erranding' status
            }
        },
        {
            '$lookup': {
                'from': 'resources', # Assuming 'resources' collection name
                'localField': 'serviceRequest',
                'foreignField': '_id',
                'as': 'serviceRequestDoc'
            }
        },
        {
            '$unwind': '$serviceRequestDoc'
        },
        {
            '$lookup': {
                'from': 'errands', # Assuming 'errands' collection name
                'localField': 'serviceRequestDoc.assignedErrandID',
                'foreignField': '_id',
                'as': 'errandDoc'
            }
        },
        {
            '$unwind': '$errandDoc'
        },
        {
            '$match': {
                'errandDoc.completedAt': {'$lte': auto_complete_threshold} # Simplified condition
            }
        }
    ]

    try:
        # Iterate through matches found by the aggregation pipeline
        # Ensure db_client is available before attempting to use it
        if not db_client:
            raise ConnectionError("MongoDB client is not initialized. Cannot perform cleanup job.")

        for match_doc in match_collection.aggregate(pipeline): # Use match_collection
            match_id = match_doc['_id']
            
            # Start a transaction for each match to ensure atomicity of updates
            with db_client.start_session() as session: # Use db_client for session
                with session.start_transaction():
                    try:
                        success = await _process_match_completion(match_id, session=session)
                        if success:
                            print(f"Successfully auto-completed match {match_id}.")
                            # You may want to add notification logic here
                            # For example, enqueue a notification job for the owner
                        else:
                            print(f"Skipped auto-completion for match {match_id}.")
                    except Exception as e:
                        session.abort_transaction() # Ensure rollback on any error during processing
                        print(f"Error processing match {match_id}: {e}. Transaction aborted.")
                        job.log(f"Error processing match {match_id}: {e}")
            
    except Exception as e:
        print(f"Error during MongoDB aggregation query or transaction management: {e}")
        job.log(f"Worker-level error during cleanup: {e}")
        raise # Re-raise to mark job as failed

    print(f"Finished processing job {job.id}.")
