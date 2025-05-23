import React, { useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import './index.scss';

export default function TabBar() {
  const router = useRouter();
  const currentPath = router?.path || 'pages/index/index';

  useEffect(() => {
    console.log('TabBar mounted, current path:', currentPath);
    // Hide the default tab bar since we're using a custom one
    Taro.hideTabBar();
  }, []);

  const handleTabClick = (path) => {
    if (path !== currentPath) {
      console.log("Switching to:", path);
      Taro.switchTab({
        url: '/' + path,
        fail: (err) => {
          console.error('Failed to switch tab:', err);
          // Fallback to navigateTo if switchTab fails
          Taro.navigateTo({ url: '/' + path });
        }
      });
    }
  };

  return (
    <View className='tab-bar'>
      <View className='tab-bar-border'></View>
      <View
        className={`tab-bar-item ${currentPath === 'pages/index/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('pages/index/index')}
      >
        <Text>首页</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === 'pages/request/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('pages/request/index')}
      >
        <Text>发布</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === 'pages/activity/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('pages/activity/index')}
      >
        <Text>活动</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === 'pages/orders/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('pages/orders/index')}
      >
        <Text>订单</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === 'pages/user/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('pages/user/index')}
      >
        <Text>我的</Text>
      </View>
    </View>
  );
} 