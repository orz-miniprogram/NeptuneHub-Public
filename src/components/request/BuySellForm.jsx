import React from 'react';
import { View, Text, Input } from '@tarojs/components';
import AddressSelector from './AddressSelector';

const BuySellForm = ({ 
  addressProps, 
  name,
  price,
  onNameChange,
  onPriceChange,
  isSubmitting 
}) => {
  return (
    <View className="buy-sell-form">
      <View className="form-section">
        <View className="section-title">物品名称</View>
        <Input
          className="input-field"
          value={name}
          onInput={onNameChange}
          placeholder="请输入物品名称"
          disabled={isSubmitting}
        />
      </View>

      <View className="form-section">
        <View className="section-title">价格</View>
        <View className="price-input">
          <Text className="currency-symbol">¥</Text>
          <Input
            className="input-field"
            type="digit"
            value={price}
            onInput={onPriceChange}
            placeholder="请输入价格"
            disabled={isSubmitting}
          />
        </View>
      </View>

      <View className="form-section">
        <View className="section-title">配送地址</View>
        <AddressSelector
          addressType="resource"
          {...addressProps}
          isSubmitting={isSubmitting}
        />
      </View>
    </View>
  );
};

export default BuySellForm; 