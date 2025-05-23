// src/components/TopNavTabs.jsx

import React from 'react'; // No need for useState, useEffect if fully controlled
import { View, Text, ScrollView } from '@tarojs/components';
// import Taro from '@tarojs/taro'; // May not need Taro directly in the component if parent handles navigation
import './TopNavTabs.scss';

// Receive activeTab and onTabChange from props
export default function TopNavTabs(props) {
     // Destructure activeTab and onTabChange from props
     const { tabs, activeTab, onTabChange } = props;
     // Removed: const [activeTab, setActiveTab] = useState(''); // <<< REMOVE internal state
     // Removed: useEffect hook that reads router params and sets internal state // <<< REMOVE effect

     // The component just needs to call onTabChange when a tab is clicked
     const handleTabClick = (value) => {
          // Removed: setActiveTab(value); // <<< REMOVE internal state update
          // Removed: Taro.navigateTo({ url: `${pagePath}?tab=${value}`, }); // <<< Parent should handle navigation/URL update
             
          // Call the onTabChange prop passed from the parent
          if (onTabChange) {
               onTabChange(value); // <<< ONLY call the prop
          }
     };

     return (
          <View className="top-nav-tabs">
               <ScrollView scrollX className="tabs-container">
                    {tabs.map((tab) => {
                         // Determine active state based *only* on the prop
                         const isActive = activeTab === tab.value; // <<< Use prop directly for rendering
                         // console.log(`Tab: ${tab.value}, isActive: ${isActive}, activeTab: ${activeTab}`); // Log is fine

                         return (
                              <View
                                   key={tab.value}
                                   className={`tab-item ${isActive ? 'active' : ''}`}
                                   onClick={() => handleTabClick(tab.value)} // Call the simplified handler
                              >
                                   <Text>{tab.label}</Text>
                              </View>
                         );
                    })}
               </ScrollView>
          </View>
     );
}