import Taro from '@tarojs/taro';

export const createRequest = async (requestData) => {
  try {
    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      throw new Error('Authentication required');
    }

    const response = await Taro.request({
      url: API_BASE_URL + '/api/requests',
      method: 'POST',
      header: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      data: requestData
    });

    if (response.statusCode === 201) {
      return {
        success: true,
        data: response.data
      };
    } else {
      return {
        success: false,
        message: response.data?.message || 'Failed to create request'
      };
    }
  } catch (error) {
    console.error('Error creating request:', error);
    return {
      success: false,
      message: error.message || 'An error occurred'
    };
  }
}; 