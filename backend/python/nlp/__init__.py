from nlp.processing import ( # Import necessary functions
    classify_resource_text,
    calculate_name_semantic_similarity, # For semantic name score
    levenshteinDistance, # For Levenshtein name score (optional as a secondary factor)
    determine_vcg_prices_for_tier,
)