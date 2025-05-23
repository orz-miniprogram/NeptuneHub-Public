const districtMap = {
  1: '第一区',
  2: '第二区',
  3: '第三区',
  4: '第四区'
};

export const getDistrictDisplayName = (districtId) => {
  return districtMap[districtId] || '';
};

export const getDistrictId = (districtName) => {
  return Object.entries(districtMap).find(([id, name]) => name === districtName)?.[0] || null;
}; 