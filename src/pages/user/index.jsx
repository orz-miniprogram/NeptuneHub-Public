// frontend/src/pages/user/index.jsx

import React, { useState, useEffect, useCallback, definePageConfig } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import './index.scss';

// Add definePageConfig for the User page itself
definePageConfig({
  navigationBarTitleText: '我的', // Set title for User page
});

// Predefined district options, consistent with user/edit/index.jsx
// For a larger app, consider moving this to a shared constants file (e.g., src/constants/districts.js)
const DISTRICT_OPTIONS = [
  { id: 1, name: '区1 - 北区' },
  { id: 2, name: '区2 - 东区' },
  { id: 3, name: '区3 - 南区' },
  { id: 4, name: '区4 - 中区' },
];

// Helper to map district IDs to display names
const getDistrictDisplayName = (districtId) => {
  const district = DISTRICT_OPTIONS.find(d => d.id === districtId);
  return district ? district.name : `区${districtId}`; // Fallback
};

export default function UserPage() {
  const [user, setUser] = useState(null); // Initialize user as null
  const [loading, setLoading] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false); // State to track login status
  // Placeholder: Set to true for 7-day initiation event.
  // In a real app, determine this dynamically (e.g., from backend or a fixed date range).
  const [isInitiationEventActive, setIsInitiationEventActive] = useState(true);

  useEffect(() => {
    checkLoginStatusAndFetchData();
  }, []); // Run once on component mount

  const checkLoginStatusAndFetchData = async () => {
    setLoading(true);
    const authToken = Taro.getStorageSync('authToken');

    if (authToken) {
      setIsLoggedIn(true);
      await fetchUserData(authToken);
    } else {
      setIsLoggedIn(false);
      setLoading(false);
      setUser(null);
    }
  };

  const goToLoginPage = () => {
    Taro.navigateTo({ url: '/pages/user/login/index' });
  };

  // Handler to navigate to the Feedback page
  const goToFeedbackPage = () => {
    Taro.navigateTo({ url: '/pages/user/feedback/index' }); // Navigate to the new feedback page
  };

  // Memoize fetchUserData so it doesn't cause re-renders unnecessarily
  const fetchUserData = useCallback(async (token) => {
    try {
      const res = await Taro.request({
        url: API_BASE_URL + `/api/auth/profile`, // Make sure API_BASE_URL is defined/imported
        method: 'GET',
        header: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (res.statusCode === 200) {
        setUser(res.data);
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        Taro.removeStorageSync('authToken');
        Taro.removeStorageSync('userId');
        setIsLoggedIn(false);
        setUser(null);
        console.warn('Authentication failed, user logged out.');
        Taro.showToast({ title: '登录过期，请重新登录', icon: 'none' }); // Translate
      } else {
        console.error(`Failed to fetch user data: Status ${res.statusCode}`);
        setUser(null);
        Taro.showToast({ title: '加载用户信息失败', icon: 'none' }); // Translate
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
      setUser(null);
      Taro.showToast({ title: '网络错误，无法加载用户信息', icon: 'none' }); // Translate
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies as token is passed as argument

  const handleBecomeRunner = useCallback(async () => {
    if (!user) {
      Taro.showToast({ title: '无法获取用户信息', icon: 'none' });
      return;
    }

    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      Taro.showToast({ title: '请登录以进行此操作', icon: 'none' });
      goToLoginPage(); // Redirect to login if no token
      return;
    }

    const walletBalance = user.wallet?.balance || 0;
    const minimumBalanceRequired = 10;

    let canBecomeRunner = false;
    let message = '';

    if (isInitiationEventActive) {
      canBecomeRunner = true;
      message = '您已成为跑腿员！此为限时活动，无需最低存款。';
    } else if (walletBalance >= minimumBalanceRequired) {
      canBecomeRunner = true;
      message = `您已成为跑腿员！请确保钱包余额大于${minimumBalanceRequired}以便开始接单。`;
    } else {
      canBecomeRunner = false;
      message = `您需要钱包余额大于${minimumBalanceRequired}才能成为跑腿员。\n您当前的余额为: ${walletBalance.toFixed(2)}`;
    }

    if (!canBecomeRunner) {
      Taro.showModal({
        title: '无法成为跑腿员',
        content: message,
        showCancel: false,
        confirmText: '确定'
      });
      return;
    }

    // Proceed to update isRunner status
    try {
      const res = await Taro.request({
        url: API_BASE_URL + `/api/auth/profile`,
        method: 'PUT',
        header: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        data: { isRunner: true } // Set isRunner to true
      });

      if (res.statusCode === 200) {
        Taro.showModal({ title: '恭喜！', content: message, showCancel: false, confirmText: '知道了' });
        fetchUserData(authToken); // Refresh user data to show updated status
      } else {
        Taro.showToast({ title: '更新跑腿员状态失败', icon: 'none' });
      }
    } catch (error) {
      Taro.showToast({ title: '网络错误，无法更新状态', icon: 'none' });
    }
  }, [user, isInitiationEventActive, fetchUserData, goToLoginPage]);


  // --- Conditional Rendering ---

  if (loading) {
    return <View className="user-page">加载中...</View>; // Translate loading
  }

  if (!isLoggedIn) {
    return (
      <View className="user-page">
        <View className="header">
          <Text>你好， </Text>
          <Text className="login-link" onClick={goToLoginPage}>请登录</Text>
        </View>
        <View className="actions">
          {/* Add the Feedback button here, even when not logged in */}
          <Button onClick={goToFeedbackPage}>反馈</Button> {/* Translate and add handler */}
        </View>
      </View>
    );
  }

  if (!user && isLoggedIn) {
    return (
      <View className="user-page">
        <View className="header">
          <Text>你好，用户</Text>
        </View>
        <View>无法加载用户信息。</View> {/* Translate */}
        <View className="actions">
          {/* Add the Feedback button here */}
          <Button onClick={goToFeedbackPage}>反馈</Button> {/* Translate and add handler */}
        </View>
        <Button onClick={() => {
          Taro.removeStorageSync('authToken');
          Taro.removeStorageSync('userId');
          setIsLoggedIn(false);
          setUser(null);
          Taro.showToast({ title: '已退出登录', icon: 'success' });
        }}>退出登录</Button>
      </View>
    );
  }

  // If logged in and user data is available
  return (
    <View className="user-page">
      <View className="header">
        <Text>你好，{user.displayName || user.username || '用户'}</Text>
      </View>
      <View className="user-info">
        {user.points !== undefined && <Text>积分: {user.points}</Text>}
        {user.credits !== undefined && <Text>信用: {user.credits}</Text>}
        {/* Removed Wallet Balance display here, as it's detailed in the new Wallet page */}
        {/* {user.wallet?.balance !== undefined && <Text>钱包余额: {user.wallet.balance.toFixed(2)}</Text>} */}

        {/* Display User's Current Addresses */}
        <View className="address-info">
          <Text className="section-title">我的地址:</Text>
          {user.addresses && user.addresses.length > 0 ? (
            user.addresses.map((addr, index) => (
              <Text key={index} className="address-item">
                {getDistrictDisplayName(addr.district)} - 楼 {getBuildingNameById(addr.building)}
                {addr.unitDetails ? ` - 单元 ${addr.unitDetails}` : ''}
              </Text>
            ))
          ) : (
            <Text>您还没有设置常用地址。</Text>
          )}
        </View>
      </View>
      <View className="actions">
        <Button>我的优惠券</Button>
        <Button onClick={() => Taro.navigateTo({ url: '/pages/user/edit/index' })}>
          编辑资料
        </Button>
        {/* NEW: My Wallet Button */}
        <Button onClick={() => Taro.navigateTo({ url: '/pages/user/wallet/index' })}>
          我的钱包 {/* Translate: My Wallet */}
        </Button>
        {/* Opt-in to be Runner Button */}
        {!user.isRunner && (
          <Button onClick={handleBecomeRunner} disabled={loading}>
            成为跑腿员
          </Button>
        )}

        {/* Add the Feedback button here */}
        <Button onClick={goToFeedbackPage}>反馈</Button>
        <Button onClick={() => {
          Taro.removeStorageSync('authToken');
          Taro.removeStorageSync('userId');
          setIsLoggedIn(false);
          setUser(null);
          Taro.showToast({ title: '已退出登录', icon: 'success' });
        }}>退出登录</Button>
      </View>
    </View>
  );
}
