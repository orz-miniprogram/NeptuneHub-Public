// Fuzzy search implementation for building names
export function fuzzyMatch(query, text) {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();
  
  let queryIndex = 0;
  let textIndex = 0;
  
  while (queryIndex < queryLower.length && textIndex < textLower.length) {
    if (queryLower[queryIndex] === textLower[textIndex]) {
      queryIndex++;
    }
    textIndex++;
  }
  
  return queryIndex === queryLower.length;
}

// Search buildings with fuzzy matching and scoring
export const searchBuildings = (query, buildings) => {
  if (!query || !buildings || !Array.isArray(buildings)) return [];

  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return [];

  return buildings
    .filter(building => {
      const buildingName = building.name.toLowerCase();
      const buildingId = building.buildingId.toLowerCase();
      return buildingName.includes(normalizedQuery) || buildingId.includes(normalizedQuery);
    })
    .sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aStartsWith = aName.startsWith(normalizedQuery);
      const bStartsWith = bName.startsWith(normalizedQuery);

      if (aStartsWith && !bStartsWith) return -1;
      if (!aStartsWith && bStartsWith) return 1;

      const aIndex = aName.indexOf(normalizedQuery);
      const bIndex = bName.indexOf(normalizedQuery);

      if (aIndex !== bIndex) return aIndex - bIndex;
      return aName.localeCompare(bName);
    })
    .slice(0, 10); // Limit results to 10 items
}; 