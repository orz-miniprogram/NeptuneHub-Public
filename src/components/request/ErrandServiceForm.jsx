import React from 'react';
import { View, Text, Input, Switch, Picker } from '@tarojs/components';
import AddressSelector from './AddressSelector';

const timeSlots = [
  '08:00-10:00',
  '10:00-12:00',
  '12:00-14:00',
  '14:00-16:00',
  '16:00-18:00',
  '18:00-20:00',
  '20:00-22:00'
];

const ErrandServiceForm = ({
  addressProps,
  timeState,
  doorDeliveryState,
  priceState,
  onTimeStateChange,
  onDoorDeliveryStateChange,
  onTipsChange,
  isSubmitting
}) => {
  const {
    timeMode,
    startDate,
    startTime,
    arrivalDate,
    arrivalTime
  } = timeState;

  const {
    fromDoorDelivery,
    toDoorDelivery,
    fromDoorUnits,
    toDoorUnits,
    fromDoorTime,
    toDoorTime
  } = doorDeliveryState;

  const { tips, basePrice } = priceState;

  return (
    <View className="errand-service-section">
      {/* From Address */}
      <View className="address-section">
        <AddressSelector
          addressType="from"
          {...addressProps}
        />
        
        {/* Door Delivery Toggle and Unit Details for From Address */}
        <View className="door-delivery-section">
          <View className="door-delivery-row">
            <View className="switch-group">
              <Switch
                checked={fromDoorDelivery}
                onChange={(e) => {
                  onDoorDeliveryStateChange('fromDoorDelivery', e.detail.value);
                  if (!e.detail.value) {
                    onDoorDeliveryStateChange('fromDoorTime', '');
                    onDoorDeliveryStateChange('fromDoorUnits', '');
                  }
                }}
                color="#4CAF50"
                disabled={isSubmitting}
              />
              <Text className="switch-label">上门取货</Text>
            </View>
          </View>
          {fromDoorDelivery && (
            <View className="door-details-row">
              <Input
                className="unit-details"
                value={fromDoorUnits}
                placeholder="具体地点"
                onInput={(e) => onDoorDeliveryStateChange('fromDoorUnits', e.detail.value)}
                disabled={isSubmitting}
              />
              <Picker
                mode="selector"
                range={timeSlots}
                onChange={(e) => onDoorDeliveryStateChange('fromDoorTime', timeSlots[e.detail.value])}
                value={timeSlots.indexOf(fromDoorTime)}
                disabled={isSubmitting}
              >
                <View className="time-picker">
                  <Text>{fromDoorTime || '选择时间'}</Text>
                </View>
              </Picker>
            </View>
          )}
        </View>
      </View>

      {/* To Address */}
      <View className="address-section">
        <AddressSelector
          addressType="to"
          {...addressProps}
        />
        
        {/* Door Delivery Toggle and Unit Details for To Address */}
        <View className="door-delivery-section">
          <View className="door-delivery-row">
            <View className="switch-group">
              <Switch
                checked={toDoorDelivery}
                onChange={(e) => {
                  onDoorDeliveryStateChange('toDoorDelivery', e.detail.value);
                  if (!e.detail.value) {
                    onDoorDeliveryStateChange('toDoorTime', '');
                    onDoorDeliveryStateChange('toDoorUnits', '');
                  }
                }}
                color="#4CAF50"
                disabled={isSubmitting}
              />
              <Text className="switch-label">送货上门</Text>
            </View>
          </View>
          {toDoorDelivery && (
            <View className="door-details-row">
              <Input
                className="unit-details"
                value={toDoorUnits}
                placeholder="具体地点"
                onInput={(e) => onDoorDeliveryStateChange('toDoorUnits', e.detail.value)}
                disabled={isSubmitting}
              />
              <Picker
                mode="selector"
                range={timeSlots}
                onChange={(e) => onDoorDeliveryStateChange('toDoorTime', timeSlots[e.detail.value])}
                value={timeSlots.indexOf(toDoorTime)}
                disabled={isSubmitting}
              >
                <View className="time-picker">
                  <Text>{toDoorTime || '选择时间'}</Text>
                </View>
              </Picker>
            </View>
          )}
        </View>
      </View>

      {/* Time Selection */}
      <View className="time-selection-section">
        <View className="time-mode-toggle">
          <Picker
            mode="selector"
            range={['不指定', '开始时间', '送达时间']}
            onChange={(e) => {
              const modes = ['off', 'starting', 'arrival'];
              onTimeStateChange('timeMode', modes[e.detail.value]);
            }}
            value={['off', 'starting', 'arrival'].indexOf(timeMode)}
            disabled={isSubmitting}
          >
            <View className="time-mode-selector">
              <Text>{timeMode === 'off' ? '不指定时间' : timeMode === 'starting' ? '指定开始时间' : '指定送达时间'}</Text>
              <View className="dropdown-arrow">▼</View>
            </View>
          </Picker>
        </View>

        {timeMode !== 'off' && (
          <View className="time-input-row">
            <Picker
              mode="date"
              value={timeMode === 'starting' ? startDate : arrivalDate}
              onChange={(e) => onTimeStateChange(timeMode === 'starting' ? 'startDate' : 'arrivalDate', e.detail.value)}
              disabled={isSubmitting}
            >
              <View className="date-picker">
                <Text>{timeMode === 'starting' ? startDate : arrivalDate || '选择日期'}</Text>
              </View>
            </Picker>
            <Picker
              mode="time"
              value={timeMode === 'starting' ? startTime : arrivalTime}
              onChange={(e) => onTimeStateChange(timeMode === 'starting' ? 'startTime' : 'arrivalTime', e.detail.value)}
              disabled={isSubmitting}
            >
              <View className="time-picker">
                <Text>{timeMode === 'starting' ? startTime : arrivalTime || '选择时间'}</Text>
              </View>
            </Picker>
          </View>
        )}
      </View>

      {/* Price Display and Tips */}
      <View className="price-section">
        <View className="base-price-display">
          <Text className="price-label">基础价格: </Text>
          <Text className="price-value">¥{basePrice}</Text>
        </View>
        <View className="tips-input">
          <Input
            type="digit"
            value={tips}
            placeholder="小费 (选填)"
            onInput={(e) => onTipsChange(e.detail.value)}
            disabled={isSubmitting}
          />
        </View>
        <View className="total-price-display">
          <Text className="price-label">总价格: </Text>
          <Text className="price-value">¥{(parseFloat(basePrice) + parseFloat(tips || 0)).toFixed(2)}</Text>
        </View>
      </View>
    </View>
  );
};

export default ErrandServiceForm; 