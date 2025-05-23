# backend/python/tasks/queue_tasks.py
# This module contains all queue tasks that are processed by the worker

from typing import Dict, Any
from datetime import datetime, timedelta
import json
import requests
from bson import ObjectId
import networkx as nx
import os
import asyncio

# Import functions and models from nlp module
from nlp.processing import (
    classify_resource_text,
    calculate_name_semantic_similarity,
    levenshteinDistance,
    determine_vcg_prices_for_tier,
    calculate_match_score,
)

# Import database connection
from .db import (
    db_client,
    db,
    resource_collection,
    match_collection,
    users_collection,
    wallets_collection,
    errands_collection,
    runner_profile_collection
)

# Import constants from config
from config import MONGO_URI, MONGO_DB_NAME, REDIS_HOST, REDIS_PORT

# Constants
MIN_MATCH_SCORE = 5
ERRAND_FEE = 2
BATCH_SIZE = 1000
SEMANTIC_SIMILARITY_WEIGHT = 5
NODEJS_NOTIFICATION_URL = 'http://localhost:5000/api/notifications/send'
MIN_REQUIRED_CREDITS = 60
ACCEPTANCE_WINDOW_DURATION = timedelta(days=1)
AUTO_COMPLETE_TIME_WINDOW_HOURS = int(os.getenv('AUTO_COMPLETE_TIME_WINDOW_HOURS', 24))

# Define compatible types for easy lookup
compatible_types = {
    'buy': 'sell',
    'sell': 'buy',
    'rent': 'lease',
    'lease': 'rent',
}

def handle_ClassifyResource_Job(data: Dict[str, Any]):
    """
    Queue task to classify a resource.
    This task is processed by the resource_queue.
    """
    print(f"Worker Tasks: Handling classifyResource job")
    resource_id_str = data.get('resourceId')

    if not resource_id_str:
        print(f"Worker Tasks: classifyResource job missing resourceId.")
        return

    if db is None or resource_collection is None:
        print(f"Worker Tasks: Database not available. Cannot process classifyResource job.")
        raise ConnectionError("Database connection not available.")

    try:
        resource_id = ObjectId(resource_id_str)
        resource_data = resource_collection.find_one({'_id': resource_id})

        if not resource_data:
            print(f"Worker Tasks: Resource {resource_id_str} not found for classification.")
            return

        print(f"Worker Tasks: Fetched resource {resource_id_str} for classification.")

        classification_results = classify_resource_text(
            resource_data.get('name'),
            resource_data.get('description')
        )

        print(f"Worker Tasks: Classification results for {resource_id_str}: {classification_results}")

        update_data = {
            'category': classification_results.get('category', resource_data.get('category')),
            'specifications': classification_results.get('specifications', resource_data.get('specifications')),
            'status': 'matching'
        }

        update_result = resource_collection.update_one({'_id': resource_id}, {'$set': update_data})

        if update_result.modified_count > 0:
            print(f"Worker Tasks: Successfully updated resource {resource_id_str} after classification.")
        else:
            print(f"Worker Tasks: Resource {resource_id_str} found but not modified after classification.")

    except Exception as e:
        print(f"Worker Tasks: Error processing classifyResource job for resource {resource_id_str}: {e}")
        try:
            resource_collection.update_one(
                {'_id': resource_id},
                {'$set': {'status': 'classification_failed', 'error_message': str(e)[:255]}}
            )
        except Exception as db_error:
            print(f"Worker Tasks: Failed to update resource {resource_id_str} status: {db_error}")
        raise

def handle_MatchResources_Job(data: Dict[str, Any]):
    """
    Queue task to match resources.
    This task is processed by the resource_queue.
    """
    print(f"Worker Tasks: Handling matchResources job")

    if db is None or resource_collection is None or match_collection is None:
         print(f"Worker Tasks: Database or collections not available. Cannot process matchResources job.")
         raise ConnectionError("Database connection not available.")

    try:
        print("Worker Tasks: Starting batching and conflict-resolving matching process...")

        # 1. Find all distinct categories with resources in 'matching' status
        distinct_categories = resource_collection.distinct('category', {'status': 'matching'})
        print(f"Worker Tasks: Found {len(distinct_categories)} distinct categories with matching resources.")

        all_potential_matches = []

        # 2. Iterate through each category
        for category in distinct_categories:
             print(f"Worker Tasks: Processing matching resources for category: {category}")
             relevant_types = set(compatible_types.keys()).union(set(compatible_types.values()))
             skip = 0
             category_resources = []

             while True:
                  batch_cursor = resource_collection.find({
                       'status': 'matching',
                       'category': category,
                       'type': {'$in': list(relevant_types)}
                  }).project({
                      'name': 1, 'type': 1, 'category': 1, 'price': 1,
                      'specifications': 1, 'userId': 1, '_id': 1
                  }).sort([('price', 1)]).skip(skip).limit(BATCH_SIZE)

                  batch = list(batch_cursor)
                  if not batch:
                       break

                  category_resources.extend(batch)
                  skip += len(batch)
                  print(f"Worker Tasks: Fetched batch of {len(batch)} resources for category {category}. Total fetched: {len(category_resources)}")

             print(f"Worker Tasks: Finished fetching all {len(category_resources)} matching resources for category {category}.")

             # Group resources by type
             resources_by_type = {}
             for resource in category_resources:
                 if resource['type'] not in resources_by_type:
                     resources_by_type[resource['type']] = []
                 resources_by_type[resource['type']].append(resource)

             # Find potential matches within category
             for resource_a in category_resources:
                 if resource_a['type'] not in compatible_types:
                     continue

                 compatible_type = compatible_types[resource_a['type']]
                 potential_counterparts = resources_by_type.get(compatible_type, [])

                 for resource_b in potential_counterparts:
                     if resource_b['_id'] == resource_a['_id'] or resource_b['category'] != resource_a['category']:
                         continue

                     # Calculate Scores
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
                             try:
                                 if json.dumps(specs_a[key], sort_keys=True) == json.dumps(specs_b[key], sort_keys=True):
                                     spec_match += 1
                             except TypeError as e:
                                 print(f"Worker Tasks: Warning: Could not compare specifications due to TypeError: {e}")
                                 pass

                     spec_score = spec_match * 2
                     score = name_score + spec_score

                     # Price Compatibility Check
                     priceA = resource_a.get('price')
                     priceB = resource_b.get('price')
                     typeA = resource_a.get('type')
                     typeB = resource_b.get('type')

                     isPriceCompatible = False
                     if priceA is not None and priceB is not None and isinstance(priceA, (int, float)) and isinstance(priceB, (int, float)):
                          if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
                               isPriceCompatible = priceA >= priceB + ERRAND_FEE
                          elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
                               isPriceCompatible = priceB >= priceA + ERRAND_FEE

                     if score >= MIN_MATCH_SCORE and isPriceCompatible:
                         all_potential_matches.append({
                             'resourceA': dict(resource_a),
                             'resourceB': dict(resource_b),
                             'score': score,
                             'priceA': priceA,
                             'priceB': priceB,
                             'typeA': typeA,
                             'typeB': typeB,
                         })

        print(f"Worker Tasks: Collected {len(all_potential_matches)} total price-compatible potential matches.")

        # Sort matches by score
        all_potential_matches.sort(key=lambda x: x['score'], reverse=True)
        print("Worker Tasks: All potential matches sorted globally by score.")

        # Process matches
        createdMatches = []
        resourceIdsToUpdateStatus = set()
        matchedResourceIds = set()

        # Get current resource statuses
        allPotentialResourceIds = set()
        for pm in all_potential_matches:
             allPotentialResourceIds.add(str(pm['resourceA']['_id']))
             allPotentialResourceIds.add(str(pm['resourceB']['_id']))

        resources_in_potential_matches_cursor = resource_collection.find(
            { '_id': { '$in': [ObjectId(id_str) for id_str in allPotentialResourceIds] } },
            { '_id': 1, 'status': 1 }
        )
        statusMap = { str(r['_id']): r['status'] for r in resources_in_potential_matches_cursor }

        # Process matches by score tier
        currentScoreIndex = 0
        while currentScoreIndex < len(all_potential_matches):
            currentScore = all_potential_matches[currentScoreIndex]['score']
            tierPotentialMatches = []

            tierIndex = currentScoreIndex
            while tierIndex < len(all_potential_matches) and all_potential_matches[tierIndex]['score'] == currentScore:
                tierPotentialMatches.append(all_potential_matches[tierIndex])
                tierIndex += 1

            # Filter for available matches
            available_tier_potential_matches = []
            for potential_match in tierPotentialMatches:
                resourceA = potential_match['resourceA']
                resourceB = potential_match['resourceB']
                resourceA_id = str(resourceA['_id'])
                resourceB_id = str(resourceB['_id'])

                isResourceAAvailable = statusMap.get(resourceA_id) == 'matching' and resourceA_id not in matchedResourceIds
                isResourceBAvailable = statusMap.get(resourceB_id) == 'matching' and resourceB_id not in matchedResourceIds

                if isResourceAAvailable and isResourceBAvailable:
                    available_tier_potential_matches.append(potential_match)

            # Handle unique high score match
            is_unique_high_score_tier = (
                currentScoreIndex == 0 and
                len(available_tier_potential_matches) == 1 and
                (tierIndex == len(all_potential_matches) or all_potential_matches[tierIndex]['score'] < currentScore)
            )

            if is_unique_high_score_tier:
                # Process unique high score match
                unique_match = available_tier_potential_matches[0]
                # ... [Rest of unique high score match processing]
                print("Processing unique high score match...")
            else:
                # Handle VCG Tie-Breaking
                if len(available_tier_potential_matches) > 0:
                    # Apply bipartite matching
                    B = nx.Graph()
                    buyer_nodes_in_graph = []
                    # ... [Rest of VCG matching logic]
                    print("Processing VCG tie-breaking...")

            currentScoreIndex = tierIndex

        # Save matches and update statuses
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
                    {'$set': {'status': 'matched'}}
                )
                print(f"Worker Tasks: Successfully updated status to 'matched' for {update_result.modified_count} resources.")
            except Exception as db_error:
                print(f"Worker Tasks: Error updating resource statuses: {db_error}")

    except Exception as main_process_error:
        print(f"Worker Tasks: Error in main matchResources job process: {main_process_error}")
        raise

def handle_CleanupTimedOutMatches_Job(data: Dict[str, Any]):
    """
    Queue task to clean up timed out matches.
    This task is processed by the resource_queue.
    """
    print(f"Worker Tasks: Handling cleanupTimedOutMatches job")

    try:
        # Handle Acceptance Window timeouts
        acceptance_window_timeout_threshold = datetime.utcnow() - ACCEPTANCE_WINDOW_DURATION

        timed_out_acceptance_matches_cursor = match_collection.find({
            'status': 'pending',
            'firstAcceptanceTime': {'$ne': None, '$lt': acceptance_window_timeout_threshold}
        })

        timed_out_acceptance_matches = list(timed_out_acceptance_matches_cursor)
        print(f"Worker Tasks: Found {len(timed_out_acceptance_matches)} timed-out matches from the Acceptance Window.")

        for match in timed_out_acceptance_matches:
            match_id = str(match['_id'])
            try:
                update_result = match_collection.update_one(
                    {'_id': match['_id'], 'status': 'pending'},
                    {'$set': {
                        'status': 'cancelled',
                        'cancellationReason': 'Acceptance window expired',
                        'updatedAt': datetime.utcnow()
                    }}
                )

                if update_result.modified_count > 0:
                    timed_out_user_id = None
                    requester_accepted = bool(match.get('requesterAcceptedSuggestedPrice'))
                    owner_accepted = bool(match.get('ownerAcceptedSuggestedPrice'))

                    if not requester_accepted:
                        timed_out_user_id = match.get('requester')
                    elif not owner_accepted:
                        timed_out_user_id = match.get('owner')

                    if timed_out_user_id:
                        match_collection.update_one(
                            {'_id': match['_id']},
                            {'$set': {'timeoutPenaltyAppliedTo': timed_out_user_id}}
                        )

                        users_collection.update_one(
                            {'_id': timed_out_user_id},
                            {'$inc': {'points': -5}}
                        )

                        # Send notifications
                        notification_payload = {
                            'recipientUserIds': [str(match.get('requester')), str(match.get('owner'))],
                            'messageKey': 'match_timed_out_penalty',
                            'data': {
                                'matchId': match_id,
                                'timedOutUserId': str(timed_out_user_id) if timed_out_user_id else None,
                            }
                        }
                        try:
                            response = requests.post(NODEJS_NOTIFICATION_URL, json=notification_payload)
                            response.raise_for_status()
                        except Exception as notify_error:
                            print(f"Worker Tasks: Error sending notification: {notify_error}")

            except Exception as process_match_error:
                print(f"Worker Tasks: Error processing match {match_id}: {process_match_error}")

        # Handle Initial Pending Window timeouts
        initial_pending_timeout_threshold = datetime.utcnow() - ACCEPTANCE_WINDOW_DURATION
        timed_out_initial_pending_matches_cursor = match_collection.find({
            'status': 'pending',
            'firstAcceptanceTime': None,
            'createdAt': {'$lt': initial_pending_timeout_threshold}
        })

        timed_out_initial_pending_matches = list(timed_out_initial_pending_matches_cursor)
        print(f"Worker Tasks: Found {len(timed_out_initial_pending_matches)} timed-out matches from Initial Pending Window.")

        for match in timed_out_initial_pending_matches:
            match_id = str(match['_id'])
            try:
                update_result = match_collection.update_one(
                    {'_id': match['_id'], 'status': 'pending'},
                    {'$set': {
                        'status': 'cancelled',
                        'cancellationReason': 'Initial pending window expired',
                        'updatedAt': datetime.utcnow()
                    }}
                )

                if update_result.modified_count > 0:
                    notification_payload = {
                        'recipientUserIds': [str(match.get('requester')), str(match.get('owner'))],
                        'messageKey': 'match_cancelled_no_action',
                        'data': {'matchId': match_id}
                    }
                    try:
                        response = requests.post(NODEJS_NOTIFICATION_URL, json=notification_payload)
                        response.raise_for_status()
                    except Exception as notify_error:
                        print(f"Worker Tasks: Error sending notification: {notify_error}")

            except Exception as process_match_error:
                print(f"Worker Tasks: Error processing match {match_id}: {process_match_error}")

    except Exception as main_cleanup_error:
        print(f"Worker Tasks: Error in cleanup process: {main_cleanup_error}")
        raise

def handle_AutoCompleteMatch_Job(data: Dict[str, Any]):
    """
    Queue task to handle auto-complete matches.
    This task is processed by the auto_complete_match_queue.
    """
    print(f"Processing auto-complete match job")

    auto_complete_threshold = datetime.utcnow() - timedelta(hours=AUTO_COMPLETE_TIME_WINDOW_HOURS)

    pipeline = [
        {
            '$match': {
                'status': 'erranding'
            }
        },
        {
            '$lookup': {
                'from': 'resources',
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
                'from': 'errands',
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
                'errandDoc.completedAt': {'$lte': auto_complete_threshold}
            }
        }
    ]

    try:
        if not db_client:
            raise ConnectionError("MongoDB client is not initialized")

        for match_doc in match_collection.aggregate(pipeline):
            match_id = match_doc['_id']
            
            with db_client.start_session() as session:
                with session.start_transaction():
                    try:
                        success = _process_match_completion(match_id, session=session)
                        if success:
                            print(f"Successfully auto-completed match {match_id}")
                    except Exception as e:
                        session.abort_transaction()
                        print(f"Error processing match {match_id}: {e}")
                        raise

    except Exception as e:
        print(f"Error during auto-complete job: {e}")
        raise

def _process_match_completion(match_id: ObjectId, session=None):
    """
    Helper function for processing match completion.
    """
    print(f"Attempting auto-completion for match {match_id}...")

    match = match_collection.find_one({'_id': match_id}, session=session)
    if not match:
        print(f"Match {match_id} not found during auto-completion process.")
        return False

    if match.get('status') == 'completed' or not match.get('owner'):
        return False

    owner_id = match['owner']
    final_amount = match.get('finalAmount')

    if not isinstance(final_amount, (int, float)) or final_amount <= 0:
        raise ValueError("Invalid finalAmount for wallet credit.")

    # Credit owner's wallet
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
        raise ValueError(f"Wallet not found for owner {owner_id}")

    # Award points and credits
    owner_user = users_collection.find_one({'_id': owner_id}, session=session)
    if not owner_user:
        raise ValueError(f"Owner user {owner_id} not found")

    points_earned = int(final_amount)
    owner_user['points'] = owner_user.get('points', 0) + points_earned

    credits_awarded = 0
    if owner_user.get('credits', 0) < 100:
        owner_user['credits'] = owner_user.get('credits', 0) + 1
        credits_awarded = 1

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

    # Update match status
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

    return True

def populate_potential_matches_job(data: Dict[str, Any]):
    """
    Queue task to populate potential matches between service-requests and service-offers.
    This task is processed by the resource_queue.
    """
    print(f"Worker Tasks: Handling populatePotentialMatches job")

    if not db_client or not db:
        print("MongoDB connection not established. Exiting job.")
        raise ConnectionError("MongoDB client is not initialized.")

    try:
        time_window = datetime.utcnow() - timedelta(minutes=10)

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

        # 2. Fetch relevant 'service-offer' resources
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

        # Map service offers to runner profiles
        runner_profile_map = {}
        if service_offers:
            runner_ids = [offer['userId'] for offer in service_offers]
            runner_profiles_cursor = runner_profile_collection.find({'userId': {'$in': runner_ids}})
            for profile in runner_profiles_cursor:
                runner_profile_map[profile['userId']] = profile

        print(f"Fetched {len(runner_profile_map)} runner profiles for active offers.")

        # 3. Iterate and Score
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
                            'matchedAt': datetime.utcnow(),
                            'offerId': s_offer['_id']
                        }

                        updates_queue.append(
                            {
                                'filter': {'_id': runner_profile_doc['_id'], 'potentialErrandRequests.requestId': s_req['_id']},
                                'update': {'$set': {'potentialErrandRequests.$[elem]': potential_match_entry}},
                                'array_filters': [{'elem.requestId': s_req['_id']}]
                            }
                        )
                        updates_queue.append(
                            {
                                'filter': {'_id': runner_profile_doc['_id'], 'potentialErrandRequests.requestId': {'$ne': s_req['_id']}},
                                'update': {'$push': {'potentialErrandRequests': potential_match_entry}}
                            }
                        )
                        print(f"Calculated score {score} for request {s_req['_id']} with offer {s_offer['_id']}.")
        
        # Execute bulk write operations
        if updates_queue:
            from pymongo import UpdateOne
            bulk_operations = []
            for op in updates_queue:
                if 'array_filters' in op:
                    bulk_operations.append(UpdateOne(op['filter'], op['update'], array_filters=op['array_filters']))
                else:
                    bulk_operations.append(UpdateOne(op['filter'], op['update']))
            
            if bulk_operations:
                try:
                    result = runner_profile_collection.bulk_write(bulk_operations)
                    print(f"Bulk write completed. Upserted: {result.upserted_count}, Matched: {result.matched_count}, Modified: {result.modified_count}")
                except Exception as e_bulk:
                    print(f"Error during bulk write: {e_bulk}")
                    raise
        
        print("Finished calculating and updating potential matches.")

    except Exception as e_job:
        print(f"Error in populatePotentialMatches job: {e_job}")
        raise

def handle_AssignErrand_Job(data: Dict[str, Any]):
    """
    Queue task to assign runners to pending service-request resources.
    This task is processed by the resource_queue.
    """
    print(f"Worker Tasks: Handling assignErrand job")

    if not db_client or not db:
        print("MongoDB connection not established. Exiting job.")
        raise ConnectionError("MongoDB client is not initialized.")

    try:
        # 1. Identify Pending 'service-request' Resources
        pending_service_requests_cursor = resource_collection.find(
            {
                'type': 'service-request',
                'status': 'matching',
                'assignedErrandId': {'$exists': False}
            }
        ).sort('createdAt', 1).limit(BATCH_SIZE)

        pending_service_requests = list(pending_service_requests_cursor)
        if not pending_service_requests:
            print("No pending 'service-request' resources found for assignment.")
            return

        print(f"Found {len(pending_service_requests)} pending 'service-request' resources.")

        # Process each service-request
        for s_req_resource in pending_service_requests:
            resource_id = s_req_resource['_id']
            resource_specs = s_req_resource.get('specifications', {})
            resource_name = s_req_resource.get('name', f"Errand Request {resource_id}")

            print(f"\n--- Processing service-request: {resource_id} ---")

            # 2. Find Best Potential Runner
            potential_runners_cursor = runner_profile_collection.find(
                {
                    'potentialErrandRequests.requestId': resource_id,
                    'currentActiveErrand': {'$exists': False}
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

            # Score and sort runners
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
                print(f"No eligible runners found for service-request: {resource_id}.")
                resource_collection.update_one(
                    {'_id': resource_id},
                    {'$inc': {'matchAttempts': 1}}
                )
                continue

            eligible_runners.sort(key=lambda x: (x['score'], x['matchedAt']), reverse=True)
            best_runner_entry = eligible_runners[0]
            best_runner_profile = best_runner_entry['runner_profile']
            assigned_runner_id = best_runner_profile['userId']

            # 3. Create New Errand Document in a transaction
            with db_client.start_session() as session:
                with session.start_transaction():
                    try:
                        new_errand_doc = {
                            'resourceRequestId': resource_id,
                            'currentStatus': 'pending',
                            'errandRunner': assigned_runner_id,
                            'runnerAssignedAt': datetime.utcnow(),
                            'pickupLocation': resource_specs.get('from_address', {}),
                            'dropoffLocation': resource_specs.get('to_address', {}),
                            'isDeliveryToDoor': resource_specs.get('door_delivery', False),
                            'deliveryFee': float(s_req_resource.get('price', 0)) if s_req_resource.get('price') is not None else 0,
                            'doorDeliveryUnits': int(resource_specs.get('door_delivery_units', 0)) if resource_specs.get('door_delivery_units') is not None else 0,
                            'expectedStartTime': resource_specs.get('expectedStartTime'),
                            'expectedEndTime': resource_specs.get('expectedEndTime'),
                            'expectedTimeframeString': resource_specs.get('expectedTimeframeString'),
                            'createdAt': datetime.utcnow(),
                            'updatedAt': datetime.utcnow()
                        }

                        if not isinstance(new_errand_doc['resourceRequestId'], ObjectId):
                            new_errand_doc['resourceRequestId'] = ObjectId(new_errand_doc['resourceRequestId'])
                        if not isinstance(new_errand_doc['errandRunner'], ObjectId):
                            new_errand_doc['errandRunner'] = ObjectId(new_errand_doc['errandRunner'])

                        insert_result = errands_collection.insert_one(new_errand_doc, session=session)
                        new_errand_id = insert_result.inserted_id

                        # Update resource status
                        resource_collection.update_one(
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

                        # Update runner profile
                        runner_profile_collection.update_one(
                            {'_id': best_runner_profile['_id']},
                            {
                                '$pull': {'potentialErrandRequests': {'requestId': resource_id}},
                                '$set': {'currentActiveErrand': new_errand_id}
                            },
                            session=session
                        )

                        # Send notification
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
                        try:
                            response = requests.post(
                                NODEJS_NOTIFICATION_URL,
                                json=notification_payload,
                                headers=headers,
                                timeout=5
                            )
                            response.raise_for_status()
                        except Exception as notify_error:
                            print(f"Error sending notification: {notify_error}")

                        session.commit_transaction()
                        print(f"Successfully assigned errand {new_errand_id} to runner {assigned_runner_id}")

                    except Exception as e_transaction:
                        session.abort_transaction()
                        print(f"Error during transaction: {e_transaction}")
                        resource_collection.update_one(
                            {'_id': resource_id},
                            {'$inc': {'matchAttempts': 1}}
                        )

    except Exception as e_job:
        print(f"Error in assignErrand job: {e_job}")
        raise 