import React, { useState } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';

export default function TopNavTabs(props) {
  const { tabs, pagePath } = props;
  const [activeTab, setActiveTab] = useState(tabs.length > 0 ? tabs[0].value : '');

  const handleTabClick = (value) => {
    setActiveTab(value);
    Taro.navigateTo({
      url: `${pagePath}?tab=${value}`,
    });
  };

  return (
    <View style={{
      width: '100%',
      backgroundColor: '#f8f8f8',
      borderBottom: '1px solid #eee',
      whiteSpace: 'nowrap',
      overflowX: 'auto',
      '-webkit-overflow-scrolling': 'touch',
    }}>
      {tabs.map((tab) => (
        <View
          key={tab.value}
          style={{
            display: 'inline-block', // Inline block for horizontal layout
            padding: '15px 20px', // Adjust padding
            fontSize: '16px', // Adjust font size
            color: activeTab === tab.value ? 'green' : 'black',
            borderBottom: activeTab === tab.value ? '2px solid green' : 'none',
            fontWeight: activeTab === tab.value ? 'bold' : 'normal',
          }}
          onClick={() => handleTabClick(tab.value)}
        >
          <Text>{tab.label}</Text>
        </View>
      ))}
    </View>
  );
}