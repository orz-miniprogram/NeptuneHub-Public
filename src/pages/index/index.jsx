import React from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { useLoad, definePageConfig } from '@tarojs/taro';
import backgroundImage from '../../assets/images/background.png';
import pickImage from '../../assets/images/pick.png';
import requestIcon from '../../assets/icons/request.png';
import offerIcon from '../../assets/icons/offer.png';
import './index.scss';

definePageConfig({
  navigationBarTitleText: '首页',
});

export default function Index() {
  useLoad(() => {
    console.log('Page loaded.');
  });

  const navigateToRequest = (type) => {
    console.log('Setting pendingRequestType in localStorage:', type);
    // Store the type in local storage before switching tabs
    try {
      Taro.setStorageSync('pendingRequestType', type);
      console.log('Successfully stored pendingRequestType:', type);
    } catch (err) {
      console.error('Failed to store pendingRequestType:', err);
    }
    
    // Switch to the request tab
    Taro.switchTab({
      url: '/pages/request/index',
      success: () => {
        console.log('Successfully switched to request tab with type:', type);
      },
      fail: (err) => {
        console.error('Failed to switch tab:', err);
        Taro.showToast({
          title: '页面跳转失败',
          icon: 'none'
        });
      }
    });
  };

  const handlePickClick = () => {
    Taro.navigateTo({
      url: '/pages/activity/index',
    });
  };

  return (
    <View className="container">
      <Image className="bg-image" src={backgroundImage} mode="aspectFill" />
      <View className="content">
        <View className="title-section">
          <Text className="main-title">BIT</Text>
          <Text className="sub-title">520</Text>
          <Text className="chinese-text">与你相约</Text>
          <Text className="chinese-sub-text">美食盛宴</Text>
          <Text className="chinese-last-text">等你来</Text>
        </View>
        
        <View className="pick-button-container" onClick={handlePickClick}>
          <View className="pick-button">
            <Image className="pick-image" src={pickImage} mode="aspectFit" />
            <Text>PICK</Text>
          </View>
        </View>

        <View className="bottom-actions">
          <View className="action-item" onClick={() => navigateToRequest('buy')}>
            <Image className="action-icon" src={requestIcon} />
            <Text>求助</Text>
          </View>
          <View className="action-item" onClick={() => navigateToRequest('sell')}>
            <Image className="action-icon" src={offerIcon} />
            <Text>帮忙</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
