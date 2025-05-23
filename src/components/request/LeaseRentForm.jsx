import React from 'react';
import { View, Text, Input, Switch, Picker } from '@tarojs/components';
import { getCurrentDate } from '../../utils/dateUtils';

const LeaseRentForm = ({
  durationState,
  rentalState,
  onDurationModeChange,
  onPeriodQuantityChange,
  onPeriodUnitChange,
  onFromTimeChange,
  onToTimeChange,
  onRentalRateChange,
  onRentalUnitChange,
  isSubmitting
}) => {
  const { 
    durationInputMode, 
    periodQuantity, 
    periodUnit, 
    fromTime, 
    toTime 
  } = durationState;

  const { 
    rentalRate, 
    rentalUnit, 
    calculatedTotalRentalPrice 
  } = rentalState;

  return (
    <View className="lease-rent-section">
      <View className='input-group price-input'>
        <Input
          className='input-field'
          type='digit'
          value={rentalRate}
          onInput={e => onRentalRateChange(e.detail.value)}
          placeholder='单位租赁价格'
          disabled={isSubmitting}
        />
        <Picker
          mode="selector"
          range={['每天', '每周', '每月']}
          onChange={e => onRentalUnitChange(['每天', '每周', '每月'][e.detail.value])}
          disabled={isSubmitting}
        >
          <View className='unit-selector'>
            <Text>{rentalUnit}</Text>
            <View className='dropdown-arrow'>▼</View>
          </View>
        </Picker>
      </View>

      <View className='duration-input-section'>
        <View className='duration-mode-toggle'>
          <Switch
            checked={durationInputMode === 'period'}
            onChange={e => onDurationModeChange(e.detail.value ? 'period' : 'toDate')}
            color="#4CAF50"
            disabled={isSubmitting}
          />
          <Text className="toggle-label">{durationInputMode === 'period' ? '时长' : '结束日期'}</Text>
        </View>

        {durationInputMode === 'toDate' ? (
          <View className='date-range-inputs'>
            <View className='date-input-row'>
              <View className='date-input'>
                <Input
                  className='input-field'
                  value={fromTime}
                  placeholder='开始日期'
                  onInput={e => onFromTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                />
                <Picker
                  mode='date'
                  value={fromTime}
                  start={getCurrentDate()}
                  onChange={e => onFromTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                >
                  <View className='date-picker-icon'>📅</View>
                </Picker>
              </View>

              <View className='date-input'>
                <Input
                  className='input-field to-date-input'
                  value={toTime}
                  placeholder='结束日期'
                  onInput={e => onToTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                />
                <Picker
                  mode='date'
                  value={toTime}
                  start={fromTime || getCurrentDate()}
                  onChange={e => onToTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                >
                  <View className='date-picker-icon'>📅</View>
                </Picker>
              </View>
            </View>
          </View>
        ) : (
          <View className='period-inputs'>
            <View className='date-input-row'>
              <View className='date-input'>
                <Input
                  className='input-field'
                  value={fromTime}
                  placeholder='开始日期'
                  onInput={e => onFromTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                />
                <Picker
                  mode='date'
                  value={fromTime}
                  start={getCurrentDate()}
                  onChange={e => onFromTimeChange(e.detail.value)}
                  disabled={isSubmitting}
                >
                  <View className='date-picker-icon'>📅</View>
                </Picker>
              </View>

              <Input
                className='period-input'
                type='text'
                value={periodQuantity}
                onInput={e => {
                  const value = e.detail.value;
                  if (value === '' || /^\d+$/.test(value)) {
                    onPeriodQuantityChange(value);
                  }
                }}
                placeholder='时长'
                disabled={isSubmitting}
              />

              <Picker
                mode="selector"
                range={['天', '周', '月']}
                onChange={e => onPeriodUnitChange(['天', '周', '月'][e.detail.value])}
                disabled={isSubmitting}
              >
                <View className='period-unit-selector'>
                  <Text>{periodUnit}</Text>
                  <View className='dropdown-arrow'>▼</View>
                </View>
              </Picker>
            </View>
          </View>
        )}
      </View>

      {calculatedTotalRentalPrice > 0 && (
        <View className='total-price-display'>
          <Text className='total-price-label'>总价格: </Text>
          <Text className='total-price-value'>¥{calculatedTotalRentalPrice.toFixed(2)}</Text>
        </View>
      )}
    </View>
  );
};

export default LeaseRentForm; 