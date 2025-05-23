import React from 'react';
import { View, Text, Input } from '@tarojs/components';
import { getBuildingNameById } from '../../data/buildings';
import { getDistrictDisplayName } from '../../utils/districtUtils';

const AddressSelector = ({
  addressType,
  currentAddress = {},
  buildingSearchQuery = '',
  buildingSearchResults = [],
  showBuildingResults = false,
  showDropdown = false,
  addressInputMode = 'select',
  defaultAddress = null,
  userAddresses = [],
  onBuildingSearch,
  onDropdownToggle,
  onBuildingSelect,
  onSavedAddressSelect,
  onInputModeChange,
  onUnitDetailsChange,
  isSubmitting = false
}) => {
  const getPlaceholderText = () => {
    if (addressType === 'resource') {
      return '请输入送货地址';
    }
    return addressType === 'from' ? '请输入起点地址' : '请输入终点地址';
  };

  const getDisplayText = (address) => {
    if (!address?.building) return '';
    const buildingName = getBuildingNameById(address.building) || '';
    const districtName = getDistrictDisplayName(address.district) || '';
    const unitText = address.unitDetails ? ` • ${address.unitDetails}` : '';
    return `${buildingName}${unitText}${districtName ? ` (${districtName})` : ''}`;
  };

  // Ensure arrays are defined
  const safeUserAddresses = Array.isArray(userAddresses) ? userAddresses : [];
  const safeBuildingResults = Array.isArray(buildingSearchResults) ? buildingSearchResults : [];

  return (
    <View className="address-search-container">
      <View className="input-wrapper">
        {addressInputMode === 'select' ? (
          <View 
            className="address-select-field"
            onClick={(e) => onDropdownToggle?.(addressType, e)}
          >
            <Text className={`address-text ${!currentAddress?.building ? 'placeholder' : ''}`}>
              {currentAddress?.building ? getDisplayText(currentAddress) : '选择地址'}
            </Text>
            <View className="dropdown-arrow" />
          </View>
        ) : (
          <View className="manual-input-wrapper">
            <Input
              className="building-search-input"
              type="text"
              placeholder={getPlaceholderText()}
              value={buildingSearchQuery}
              onInput={e => onBuildingSearch?.(addressType, e?.detail?.value)}
              onFocus={() => onBuildingSearch?.(addressType, buildingSearchQuery)}
              disabled={isSubmitting}
            />
            <View 
              className="back-to-select"
              onClick={() => onInputModeChange?.('select')}
            >
              <View className="dropdown-arrow" />
            </View>
          </View>
        )}
      </View>

      {(showDropdown && addressInputMode === 'select') && (
        <View className="address-dropdown">
          {defaultAddress && (
            <View
              className="saved-address-item default-address"
              onClick={() => onSavedAddressSelect?.(addressType, defaultAddress)}
            >
              <View className="address-details">
                <Text className="address-name">
                  {getBuildingNameById(defaultAddress.building)}
                  <Text className="default-tag">默认</Text>
                </Text>
                {defaultAddress.unitDetails && (
                  <Text className="unit-details">{defaultAddress.unitDetails}</Text>
                )}
                <Text className="district-name">
                  {getDistrictDisplayName(defaultAddress.district)}
                </Text>
              </View>
            </View>
          )}
          {safeUserAddresses
            .filter(addr => addr && !addr.isDefault)
            .map((address, index) => (
              <View
                key={index}
                className="saved-address-item"
                onClick={() => onSavedAddressSelect?.(addressType, address)}
              >
                <View className="address-details">
                  <Text className="address-name">
                    {getBuildingNameById(address?.building)}
                  </Text>
                  {address?.unitDetails && (
                    <Text className="unit-details">{address.unitDetails}</Text>
                  )}
                  <Text className="district-name">
                    {getDistrictDisplayName(address?.district)}
                  </Text>
                </View>
              </View>
            ))}
          <View
            className="input-other-option"
            onClick={() => onInputModeChange?.('input')}
          >
            <Text>选择其他地址</Text>
          </View>
        </View>
      )}

      {(showBuildingResults && addressInputMode === 'input' && buildingSearchQuery) && (
        <View className="building-search-results">
          {safeBuildingResults.map((building, index) => (
            <View
              key={index}
              className="building-result-item"
              onClick={() => onBuildingSelect?.(addressType, building)}
            >
              <Text className="building-name">{building?.name || ''}</Text>
              <Text className="district-name">
                {getDistrictDisplayName(building?.district)}
              </Text>
            </View>
          ))}
          {safeBuildingResults.length === 0 && (
            <View className="no-results">
              <Text>未找到相关建筑物</Text>
            </View>
          )}
        </View>
      )}

      {currentAddress?.building && (
        <Input
          className="unit-details-input"
          type="text"
          placeholder="单元号/门牌号 (选填)"
          value={currentAddress.unitDetails || ''}
          onInput={e => onUnitDetailsChange?.(addressType, e?.detail?.value)}
          disabled={isSubmitting}
        />
      )}
    </View>
  );
};

export default AddressSelector; 