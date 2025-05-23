# backend/python/nlp/processing.py

from .models import nlp_pipeline, sentence_transformer_model # Import loaded models
import re
import numpy as np # Using numpy for matrix creation can be efficient, or use list of lists
import sys # To potentially import sys.maxsize if needed for initialization (not strictly needed for this basic version)
import datetime

# Define categories
categories = ["Electronics", "Books", "Errands", "Furniture"]
category_embeddings = None

def initialize_category_embeddings():
    """Initialize category embeddings if the model is available."""
    global category_embeddings
    if sentence_transformer_model is not None and category_embeddings is None:
        try:
            category_embeddings = np.array([sentence_transformer_model.encode([cat])[0] for cat in categories])
            print("NLP: Category embeddings initialized successfully.")
            return True
        except Exception as e:
            print(f"NLP: Failed to initialize category embeddings: {e}")
            category_embeddings = None
            return False
    return category_embeddings is not None

# Try to initialize embeddings on module load
initialize_category_embeddings()

# Subcategories for errands
ERRAND_CATEGORIES = {
    "takeout": ["food", "takeout", "meal", "lunch", "dinner", "奶茶", "外卖"],
    "package": ["package", "express", "parcel", "快递", "取件"],
    "documents": ["document", "paper", "report", "打印", "文档", "资料"],
    "ride": ["ride", "car", "pickup", "接送", "顺风车", "代步"],
    "purchase": ["buy", "purchase", "带", "买", "帮我买", "便利店", "纸", "厕纸", "超市", "矿泉水"],
    "misc": []
}

# --- The Main classify_resource_text Function (Complete Version) ---
# This function performs the full classification and specification extraction/merging process.
# This function now ensures that for "Errands" type resources, the 'category' field itself gets
# a granular errand type (e.g., "takeout", "package").
def classify_resource_text(name: str, description: str, existing_specifications: dict) -> dict:
    """
    Classify resource into category (with granular errand type if 'Errands') and extract/merge specifications.

    Args:
        name: The name of the resource.
        description: The description of the resource.
        existing_specifications: The specifications dictionary already populated
                                 from userSpecs in the API request.

    Returns:
        A dictionary containing classification results and merged specifications.
        The 'category' key will now contain the granular errand type for errand Resources.
    """
    print("NLP: Starting resource classification...")
    try:
        text = f"{name} {description}".strip()
        print(f"NLP: Classifying text: '{text[:100]}...'") # Log first 100 chars

        # 1. Broad Category Classification (using Sentence Embeddings)
        # This step initially identifies the broad category (e.g., "Errands", "Electronics").
        # Using YOUR 'sentence_transformer_model'
        if not initialize_category_embeddings():
            print("NLP: Category embeddings not available. Using fallback classification.")
            broad_category_from_nlp = "misc"
        else:
            try:
                embedding = sentence_transformer_model.encode([text])[0]
                similarities = np.dot(category_embeddings, embedding) / (
                    np.linalg.norm(category_embeddings, axis=1) * np.linalg.norm(embedding)
                )
                best_match = np.argmax(similarities)
                broad_category_from_nlp = categories[best_match] # e.g., "Errands", "Electronics"
                print(f"NLP: Classified as broad category: {broad_category_from_nlp}")
            except Exception as e:
                print(f"NLP: Error during broad category classification: {e}")
                broad_category_from_nlp = "misc"

        # Initialize the final category that will be returned.
        # It defaults to the broad category, but will be refined for "Errands".
        final_category_for_resource = broad_category_from_nlp
        extracted_fuzzy_specs = {} # Dictionary to hold specs extracted from text

        # 2. Granular Errand Classification and Specification Extraction (Category Specific)
        # If the broad category is "Errands", we perform a more granular classification
        # and update the 'category' to one of the ERRAND_CATEGORIES keys.
        if broad_category_from_nlp == "Errands":
            print("NLP: Broad category is 'Errands'. Performing granular classification...")
            # Using YOUR 'spacy_nlp'
            if nlp_pipeline is None:
                print("NLP: Spacy model not loaded. Cannot perform granular errand classification or extract fuzzy specs.")
                final_category_for_resource = "misc" # Fallback to default granular type on error
            else:
                try:
                    # Classify granular errand type using ERRAND_CATEGORIES.
                    # Using YOUR 'classify_errand_subcategory'
                    granular_errand_type = classify_errand_subcategory(text)
                    final_category_for_resource = granular_errand_type # <-- THIS IS THE KEY CHANGE!
                    print(f"NLP: Classified as granular errand type: {final_category_for_resource}")

                    # Extract fuzzy errand specifications from text.
                    # Using YOUR 'extract_errand_specs'
                    extracted_fuzzy_specs.update(extract_errand_specs(text))
                    print(f"NLP: Extracted fuzzy errand specs: {extracted_fuzzy_specs}")
                except Exception as e:
                    print(f"NLP: Error during granular errand classification or spec extraction: {e}")
                    final_category_for_resource = "misc" # Fallback to default granular type on error
                    extracted_fuzzy_specs = {} # Ensure specs is an empty dict on error

        elif broad_category_from_nlp != "ClassificationError":
            # For non-Errand broad categories, just extract general specs.
            # The final_category_for_resource remains the broad_category_from_nlp.
            print(f"NLP: Handling non-Errands category: {broad_category_from_nlp}...")
            try:
                # For other categories, extract fuzzy specs from text using the general function.
                # Using YOUR 'extract_specs_by_category'
                extracted_fuzzy_specs = extract_specs_by_category(broad_category_from_nlp, name, description)
                print(f"NLP: Extracted fuzzy specs for {broad_category_from_nlp}: {extracted_fuzzy_specs}")
            except Exception as e:
                print(f"NLP: Error during non-Errand spec extraction: {e}")
                extracted_fuzzy_specs = {} # Ensure specs is an empty dict on error

        # --- CRITICAL CHANGE HERE: Prioritize existing_specifications ---
        # Merge extracted (fuzzy) and existing (user-provided) specifications.
        # User-provided specifications (on the right) will overwrite any overlapping keys
        # from extracted_fuzzy_specs.
        final_specifications = {**extracted_fuzzy_specs, **existing_specifications}
        # --- END CRITICAL CHANGE ---

        # Prepare the final result dictionary.
        result = {
            "category": final_category_for_resource, # This will now be the granular errand type for errands
            "specifications": final_specifications
        }
        # Note: The 'subcategory' field is explicitly NOT included in the returned result.

        print(f"NLP: Classification complete. Final category returned: '{result['category']}'")
        return result

    except Exception as e:
        print(f"NLP: Critical error in classify_resource_text: {e}")
        return {
            "category": "ClassificationError", # Fallback for any unexpected top-level errors
            "specifications": existing_specifications # Retain existing specs even on error
        }

def classify_errand_subcategory(text: str) -> str:
    doc = nlp_pipeline(text.lower())
    tokens = [token.text for token in doc if not token.is_stop]

    score = {cat: 0 for cat in ERRAND_CATEGORIES}
    for cat, keywords in ERRAND_CATEGORIES.items():
        for token in tokens:
            for keyword in keywords:
                if keyword in token:
                    score[cat] += 1

    best = max(score, key=score.get)
    return best if score[best] > 0 else "misc"

def extract_specs_by_category(category: str, name: str, description: str) -> dict:
    text = f"{name} {description}".strip()

    if category == "Electronics":
        return extract_electronic_specs(text)
    elif category == "Errands":
        return extract_errand_specs(text)
    elif category == "Books":
        return extract_book_specs(text)
    else:
        return extract_general_specs(text)

def extract_electronic_specs(text: str) -> dict:
    specs = {}
    storage_match = re.search(r'(\d+(?:\.\d+)?)\s*(GB|TB|兆|吉|太)字节?\s*(固态|机械)?硬盘?', text)
    ram_match = re.search(r'(\d+(?:\.\d+)?)\s*(GB|TB|MB|兆|吉|太)字节?\s*内存', text)
    screen_size = re.search(r'(\d+(?:\.\d+)?)\s*英寸', text)
    cpu_match = re.search(r'([Ii][3579])\s*[- ]?\d{3,5}[A-Z]*', text)

    if storage_match:
        specs["storage"] = storage_match.group(0)
    if ram_match:
        specs["ram"] = ram_match.group(0)
    if screen_size:
        specs["screen_size"] = screen_size.group(1) + " inch"
    if cpu_match:
        specs["cpu"] = cpu_match.group(0)

    return specs

def extract_errand_specs(text: str) -> dict:
    """
    Extracts 'fuzzy' specifications for errand resources from text (name + description).
    These details augment the structured specifications provided via userSpecs
    (like precise from/to addresses, exact delivery times, door delivery flags).

    Args:
        text: The combined string from the resource's name and description.

    Returns:
        A dictionary containing extracted fuzzy specifications.
    """
    specs = {}
    # Work with lowercase text for case-insensitive matching
    lower_text = text.lower()

    # --- 1. Extract General Errand Type Keywords ---
    # Keywords indicating the type of action requested.
    if re.search(r'(帮忙取|代取|领取|取一下)', lower_text):
        specs["general_type_text"] = "pickup"
    elif re.search(r'(代买|帮买|购买|买一下)', lower_text):
        specs["general_type_text"] = "purchase"
    elif re.search(r'(帮送|投递|送达|送一下)', lower_text):
        specs["general_type_text"] = "delivery"
    elif re.search(r'(跑腿|帮忙)', lower_text) and "general_type_text" not in specs:
         specs["general_type_text"] = "general_errand"
    # Add more patterns or refine the existing ones as needed based on common user phrasing.


    # --- 2. Extract Item Being Handled ---
    # Common items mentioned in errand requests.
    item_match = re.search(r'(外卖|快递|文件|奶茶|食物|作业|书|钥匙|雨伞)', lower_text)
    if item_match:
        specs["item_text"] = item_match.group(1)
    # Expand this list with other common items.


    # --- 3. Attempt to Extract Capacity/Size/Quantity Mentions (Fuzzy) ---
    # Recognizing patterns related to size, weight, or number of items from text.
    # These are less structured than a dedicated 'required_capacity' field.

    # Look for explicit numbers of items
    quantity_match = re.search(r'([一二三四五六七八九十\d]+)\s*(个|件|份|单|本书|箱|袋|样)', lower_text)
    if quantity_match:
        # Captures the number and unit. Consider converting Chinese numerals if needed elsewhere.
        specs["quantity_text"] = quantity_match.group(0)

    # Look for general size descriptions (basic keywords)
    size_match = re.search(r'(大|小|中|重)号?(箱子|包裹|文件|东西|有点重|不重)?', lower_text)
    if size_match:
         specs["size_text"] = size_match.group(0)

    # Look for explicit weight mentions
    weight_match = re.search(r'(\d+(?:\.\d+)?)\s*(kg|公斤|斤|克|g)', lower_text)
    if weight_match:
         specs["weight_text"] = weight_match.group(0)

    # Add more patterns for other units or phrasing related to capacity/size.


    # --- 4. Attempt to Extract Urgency or Specific Handling Instructions (Fuzzy) ---
    # Keywords indicating how quickly it's needed or special care.
    if re.search(r'(尽快|马上|急|越快越好)', lower_text):
        specs["urgency_text"] = "urgent"
    if re.search(r'(易碎|小心轻放|怕摔)', lower_text):
        specs["handling_text"] = "fragile"
    if re.search(r'(保暖|冷藏|加热)', lower_text):
         specs["handling_text"] = "temperature_sensitive" # Example of adding another type
    # Add more keywords for other instructions.


    # --- 5. (Optional) Attempt to Extract Building/Location Names as Fuzzy Text ---
    # This can help confirm or augment structured locations, but needs access to your building list.
    # If included, ensure this doesn't overwrite the structured from/to_address from userSpecs.
    # For example, you could look for mentions and store them in a separate list.
    # Example (requires building_list as input or access):
    # building_mentions = []
    # for building_info in building_list:
    #     building_name = building_info.get("name", "").lower()
    #     building_id = building_info.get("buildingId", "").lower()
    #     # Use regex to find occurrences in the text
    #     if re.search(r'\b' + re.escape(building_name) + r'\b', lower_text) or \
    #        re.search(r'\b' + re.escape(building_id) + r'\b', lower_text):
    #         building_mentions.append(building_info.get("name")) # Store the name found
    # if building_mentions:
    #     specs["building_mentions_text"] = list(set(building_mentions)) # Store unique mentions


    return specs


def extract_book_specs(text: str) -> dict:
    specs = {}
    course_match = re.search(r'(高等数学|线性代数|英语|计算机基础|概率论)', text)
    if course_match:
        specs["subject"] = course_match.group(1)
    edition_match = re.search(r'(第[一二三四五六七八九十]+版)', text)
    if edition_match:
        specs["edition"] = edition_match.group(1)
    return specs

def extract_general_specs(text: str) -> dict:
  specs = {}
  try:
      doc = nlp_pipeline(text)
      for ent in doc.ents:
          if ent.label_ in ["CARDINAL", "QUANTITY", "PRODUCT"]:
              key = ent.label_.lower()
              if key in specs:
                  specs[key] += f", {ent.text}"
              else:
                  specs[key] = ent.text
  except Exception as e:
      print(f"NLP: Failed to extract general specs: {e}")
  return specs

# --- Function to calculate Semantic Similarity for Names ---
def calculate_name_semantic_similarity(name1: str, name2: str) -> float:
    """
    Calculates semantic similarity between two names using Sentence Transformers.
    Returns a score between -1 and 1.
    """
    if sentence_transformer_model is None:
        print("NLP Processing: Sentence Transformer model not loaded. Cannot calculate semantic similarity.")
        return 0.0 # Return 0 if model not loaded

    if not name1 or not name2:
        return 0.0 # Return 0 if names are missing

    try:
        # Calculate embeddings
        embeddings = sentence_transformer_model.encode([name1, name2], convert_to_numpy=True)
        # Calculate cosine similarity using numpy
        similarity = np.dot(embeddings[0], embeddings[1]) / (np.linalg.norm(embeddings[0]) * np.linalg.norm(embeddings[1]))
        return float(similarity) # Return as float

    except Exception as e:
        print(f"NLP Processing: Error calculating semantic similarity for '{name1}' and '{name2}': {e}")
        return 0.0 # Return 0 if error occurs


# --- Include your levenshteinDistance function here or import it ---
# Assuming you have a utils file like backend/python/utils/levenshtein.py
def levenshteinDistance(s1: str, s2: str) -> int:
    """
    Calculates the Levenshtein distance between two strings.
    The Levenshtein distance is the minimum number of single-character edits
    (insertions, deletions or substitutions) required to change one word into the other.

    Args:
        s1: The first string.
        s2: The second string.

    Returns:
        The Levenshtein distance (an integer).
    """
    # Handle empty strings
    if not s1:
        return len(s2)
    if not s2:
        return len(s1)

    len1 = len(s1)
    len2 = len(s2)

    # Create a matrix (list of lists in Python)
    # matrix[i][j] will store the Levenshtein distance between the first i characters of s1
    # and the first j characters of s2.
    matrix = [[0 for _ in range(len2 + 1)] for _ in range(len1 + 1)]

    # Initialize the matrix
    # The distance from an empty string to a string of length i is i
    for i in range(len1 + 1):
        matrix[i][0] = i
    # The distance from a string of length j to an empty string is j
    for j in range(len2 + 1):
        matrix[0][j] = j

    # Fill the matrix using dynamic programming
    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            # Cost of substitution: 0 if characters are the same, 1 if different
            cost = 0 if s1[i - 1] == s2[j - 1] else 1

            # The distance matrix[i][j] is the minimum of:
            # 1. Deletion: matrix[i-1][j] + 1 (delete character from s1)
            # 2. Insertion: matrix[i][j-1] + 1 (insert character into s1)
            # 3. Substitution: matrix[i-1][j-1] + cost (substitute character)
            matrix[i][j] = min(
                matrix[i - 1][j] + 1,      # Deletion
                matrix[i][j - 1] + 1,      # Insertion
                matrix[i - 1][j - 1] + cost # Substitution
            )

    # The final distance is in the bottom-right cell of the matrix
    return matrix[len1][len2]

# --- Function to determine VCG-like prices for selected matches in a tier ---
def determine_vcg_prices_for_tier(selected_matches: list, all_available_tier_matches: list) -> list:
    """
    Determines VCG-like prices for a list of matches selected by bipartite matching
    within a score tier, using a simplified "next best participant's price" rule
    based on the prices of all available compatible counterparts in that tier.

    Args:
        selected_matches: A list of potential match objects that were selected
                          by the bipartite matching algorithm in this tier.
        all_available_tier_matches: The full list of potential match objects
                                  that were available in this tier before selection.

    Returns:
        The input list of selected matches, with 'determinedPriceA'
        and 'determinedPriceB' added to each match object.
    """
    if not selected_matches:
        return []

    print(f"NLP Processing: Determining VCG-like prices for {len(selected_matches)} selected matches in a tier.")

    # Extract all buyer and seller prices from the *entire pool* of available matches in this tier
    all_tier_buyer_prices = []
    all_tier_seller_prices = []

    for potential_match in all_available_tier_matches:
         priceA = potential_match.get('priceA')
         priceB = potential_match.get('priceB')
         typeA = potential_match.get('typeA')
         typeB = potential_match.get('typeB')

         if priceA is not None and priceB is not None:
             if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
                 all_tier_buyer_prices.append(priceA)
                 all_tier_seller_prices.append(priceB)
             elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
                 all_tier_seller_prices.append(priceA)
                 all_tier_buyer_prices.append(priceB)

    # Sort unique prices to find the second best
    # Buyer prices (bids) are sorted descending (highest bid is best for seller)
    sorted_unique_buyer_prices = sorted(list(set(all_tier_buyer_prices)), reverse=True)
    # Seller prices (asks) are sorted ascending (lowest ask is best for buyer)
    sorted_unique_seller_prices = sorted(list(set(all_tier_seller_prices)))


    print(f"NLP Processing: Tier Unique Sorted Buyer Prices (Descending): {sorted_unique_buyer_prices}")
    print(f"NLP Processing: Tier Unique Sorted Seller Prices (Ascending): {sorted_unique_seller_prices}")

    # Find the prices of the "next best" participants from the tier's full available pool
    # Second highest buyer price in the tier pool
    second_best_buyer_price_in_tier_pool = sorted_unique_buyer_prices[1] if len(sorted_unique_buyer_prices) > 1 else None

    # Second lowest seller price in the tier pool
    second_best_seller_price_in_tier_pool = sorted_unique_seller_prices[1] if len(sorted_unique_seller_prices) > 1 else None


    # Determine prices for each *selected* match
    for selected_match in selected_matches:
        priceA = selected_match['priceA']
        priceB = selected_match['priceB']
        typeA = selected_match['typeA']
        typeB = selected_match['typeB']

        determined_priceA = priceA # Default price
        determined_priceB = priceB # Default price


        if typeA in ['buy', 'lease', 'service-request'] and typeB in ['sell', 'rent', 'service-offer']:
            # resourceA is the buyer, resourceB is the seller
            buyer_price = priceA
            seller_price = priceB

            # Apply VCG-like rule for Buyer Price (p_i = min(b_j, s_{j+1}) idea)
            # Buyer pays the minimum of their bid and the second lowest seller price in the tier pool
            if second_best_seller_price_in_tier_pool is not None:
                 determined_priceA = min(buyer_price, second_best_seller_price_in_tier_pool)
            else:
                 determined_priceA = buyer_price # Fallback if no second seller in tier pool

            # Apply VCG-like rule for Seller Price (Based on image q_j = s_j rule)
            # Seller receives their asking price
            determined_priceB = seller_price


        elif typeA in ['sell', 'rent', 'service-offer'] and typeB in ['buy', 'lease', 'service-request']:
            # resourceA is the seller, resourceB is the buyer
            seller_price = priceA
            buyer_price = priceB

            # Apply VCG-like rule for Seller Price (Based on image q_j = s_j rule)
            # Seller receives their asking price
            determined_priceA = seller_price

            # Apply VCG-like rule for Buyer Price (Symmetric interpretation)
            # Buyer pays the maximum of their bid and the second highest buyer price in the tier pool
            if second_best_buyer_price_in_tier_pool is not None:
                 determined_priceB = max(buyer_price, second_best_buyer_price_in_tier_pool)
            else:
                 determined_priceB = buyer_price # Fallback


        # Add determined prices to the selected match object
        selected_match['determinedPriceA'] = determined_priceA
        selected_match['determinedPriceB'] = determined_priceB


    print("NLP Processing: VCG-like price determination for selected matches complete.")
    return selected_matches

def calculate_match_score(request_resource: dict, offer_resource: dict, runner_profile: dict) -> int:
    """
    Calculates a match score between a service-request resource and a service-offer resource
    based on their specifications and the associated runner's profile.

    Args:
        request_resource: A dictionary representing the 'service-request' Resource document.
        offer_resource: A dictionary representing the 'service-offer' Resource document (from the runner).
        runner_profile: A dictionary representing the RunnerProfile document associated with the offer_resource's user.

    Returns:
        An integer score representing the compatibility.
    """
    score = 0

    request_specs = request_resource.get('specifications', {})
    offer_specs = offer_resource.get('specifications', {}) # Details from the runner's specific offer
    runner_profile_specs = runner_profile # The runnerProfile itself acts as its 'specs' for capabilities etc.

    # --- 1. Location Matching (Primary Driver) ---
    request_pickup_building = request_specs.get('from_address', {}).get('buildingName', '').lower()
    request_dropoff_building = request_specs.get('to_address', {}).get('buildingName', '').lower()
    request_pickup_campus_zone = request_specs.get('from_address', {}).get('campusZone', '').lower()
    request_dropoff_campus_zone = request_specs.get('to_address', {}).get('campusZone', '').lower()

    runner_operating_campus_zones = [zone.lower() for zone in runner_profile_specs.get('operatingCampusZones', [])]
    # This assumes 'availabilityCampusZone' is directly on the offer_resource's specs
    offer_availability_campus_zone = offer_specs.get('availabilityCampusZone', '').lower()

    location_match_score = 0

    # Check for exact building name match for either pickup or dropoff
    # Assuming offer_availability_campus_zone could somehow represent the runner's current or preferred building
    # This interpretation of the JS code's 'offerAvailabilityCampusZone === requestPickupBuilding' seems unusual
    # if offerAvailabilityCampusZone is a 'zone' and requestPickupBuilding is a 'building name'.
    # Re-interpreting as: if the offer is available *in* a building mentioned in the request.
    # Or perhaps `offerAvailabilityCampusZone` was intended to be a building name if offer is very specific.
    # Let's stick to the JS logic as provided for now, assuming 'offerAvailabilityCampusZone' can indeed be a building name in this context.
    if (request_pickup_building and offer_availability_campus_zone == request_pickup_building) or \
       (request_dropoff_building and offer_availability_campus_zone == request_dropoff_building):
        location_match_score = 50  # High score for building match
    else:
        # Check for campus zone match for either pickup or dropoff, and if runner operates in that zone
        is_pickup_in_runner_zone = request_pickup_campus_zone and request_pickup_campus_zone in runner_operating_campus_zones
        is_dropoff_in_runner_zone = request_dropoff_campus_zone and request_dropoff_campus_zone in runner_operating_campus_zones

        if is_pickup_in_runner_zone or is_dropoff_in_runner_zone:
            # If specific offer campus zone matches one of the request's zones AND runner operates there
            if offer_availability_campus_zone and \
               (offer_availability_campus_zone == request_pickup_campus_zone or \
                offer_availability_campus_zone == request_dropoff_campus_zone):
                location_match_score = 30  # Medium score for specific offer campus zone match within runner's general zones
            else:
                location_match_score = 20  # Lower score for general campus zone match within runner's zones (if specific offer zone not strict)
    
    score += location_match_score


    # --- 2. Time Matching ---
    # Assuming request_specs has `expectedStartTime` and `expectedEndTime` (ISO strings or compatible)
    # Assuming offer_specs has `availableTimeSlots` (e.g., an array of { start: ISO, end: ISO } objects)
    
    request_start = None
    request_end = None
    offer_start = None
    offer_end = None

    try:
        if request_specs.get('expectedStartTime'):
            request_start = datetime.fromisoformat(request_specs['expectedStartTime'])
        if request_specs.get('expectedEndTime'):
            request_end = datetime.fromisoformat(request_specs['expectedEndTime'])
        
        # Assuming availableTimeSlots is an array, taking the first one for simplicity as in JS pseudocode
        if offer_specs.get('availableTimeSlots') and len(offer_specs['availableTimeSlots']) > 0:
            first_slot = offer_specs['availableTimeSlots'][0]
            if first_slot.get('start'):
                offer_start = datetime.fromisoformat(first_slot['start'])
            if first_slot.get('end'):
                offer_end = datetime.fromisoformat(first_slot['end'])
    except ValueError as e:
        print(f"Warning: Could not parse datetime for time matching. Error: {e}")
        # Continue without adding time score if parsing fails

    if request_start and request_end and offer_start and offer_end:
        # Check for any overlap in time ranges
        # Max of starts and Min of ends
        overlap_start = max(request_start, offer_start)
        overlap_end = min(request_end, offer_end)

        overlap_duration = (overlap_end - overlap_start).total_seconds() if overlap_end > overlap_start else 0

        if overlap_duration > 0:
            score += 20  # Example fixed score for overlap
            # Could also be (overlap_duration / min_duration_seconds) * 20 for better scoring
            # min_duration_seconds = min((request_end - request_start).total_seconds(), (offer_end - offer_start).total_seconds())
            # if min_duration_seconds > 0:
            #     score += (overlap_duration / min_duration_seconds) * 20


    # --- 3. Capability Matching ---
    # Door Delivery
    if request_specs.get('door_delivery') is True:
        # Check for explicit 'door-delivery' capability or implied by vehicle type
        has_door_delivery_capability = \
            'door-delivery' in runner_profile_specs.get('specialEquipment', []) or \
            runner_profile_specs.get('vehicleType') in ['foot', 'bicycle']
        
        if has_door_delivery_capability:
            score += 15
        else:
            score -= 10 # Penalize if required but not met
    
    # Cargo Capacity (Simplified)
    request_item_details = request_specs.get('item_details', {})
    request_cargo_description = request_item_details.get('size') or request_item_details.get('weightDescription') # e.g., "fits in backpack", "heavy"
    runner_cargo_capacity = runner_profile_specs.get('cargoCapacityDescription')

    # Simple string match for now; a real system would parse weights/sizes.
    if request_cargo_description and runner_cargo_capacity:
        if request_cargo_description.lower() in runner_cargo_capacity.lower(): # E.g., "fits in backpack" matched by "can carry a backpack"
            score += 5
        # Could add penalties if runner capacity is clearly insufficient.


    # Other special equipment matching (e.g., insulated food bag)
    required_equipment = request_specs.get('requiredEquipment')
    if required_equipment and isinstance(required_equipment, list):
        runner_special_equipment = runner_profile_specs.get('specialEquipment', [])
        has_all_required_equipment = all(req_eq in runner_special_equipment for req_eq in required_equipment)
        
        if has_all_required_equipment:
            score += 10
        else:
            score -= 5


    # Ensure score doesn't go below 0
    return max(0, score)
