// src/components/TabBar.jsx
import React from 'react';
import { View, Text } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import '../styles/TabBar.scss';
import Taro from '@tarojs/taro'; // Import Taro

export default function TabBar() {
  const router = useRouter();
  const currentPath = router.route;

  const handleTabClick = (path) => {
    if (path !== currentPath) {
      console.log("router.push call:", router.push);
      console.log("router object:", router);
      console.log("Navigating to:", path);

      // Try router.push first
      if (router && router.push) {
        router.push(path);
      } else {
        // Fallback to Taro.navigateTo if router.push is not available
        console.log("router.push not available, using Taro.navigateTo");
        Taro.navigateTo({ url: path });
      }
    }
  };

  return (
    <View className="tab-bar-container">
      <View
        className={`tab-bar-item ${currentPath === '/pages/index/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('/pages/index/index')}
      >
        <Text>首页</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === '/pages/request/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('/pages/request/index')}
      >
        <Text>发布</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === '/pages/activity/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('/pages/activity/index')}
      >
        <Text>活动咚咚锵</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === '/pages/orders/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('/pages/orders/index')}
      >
        <Text>订单</Text>
      </View>
      <View
        className={`tab-bar-item ${currentPath === '/pages/my/index' ? 'active' : ''}`}
        onClick={() => handleTabClick('/pages/user/index')}
      >
        <Text>我的</Text>
      </View>
    </View>
  );
}