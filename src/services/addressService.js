import Taro from '@tarojs/taro';

export const getUserAddresses = async () => {
  try {
    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      throw new Error('Authentication required');
    }

    const response = await Taro.request({
      url: API_BASE_URL + '/api/user/addresses',
      method: 'GET',
      header: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (response.statusCode === 200) {
      return response.data;
    } else {
      throw new Error(response.data?.message || 'Failed to fetch addresses');
    }
  } catch (error) {
    console.error('Error fetching user addresses:', error);
    throw error;
  }
}; 