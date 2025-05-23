// src/pages/user/edit/index.jsx

import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import { View, Text, Input, Button, Picker } from '@tarojs/components'; // Added Picker
import Taro from '@tarojs/taro';
import { buildings, getBuildingNameById } from '../../../data/buildings'; // Import buildings data and helper

import './index.scss'; // Optional: for styling (you might need to create this)

// Predefined district options based on your AddressSchema enum [1, 2, 3, 4]
// You might want to map these to more descriptive strings for display
const DISTRICT_OPTIONS = [
  { id: 1, name: '北区' },
  { id: 2, name: '东区' },
  { id: 3, name: '南区' },
  { id: 4, name: '东南校区' },
];
// Helper to map district IDs to display names for the picker options (used for saved addresses display)
  const getDistrictDisplayName = (districtId) => {
      const district = DISTRICT_OPTIONS.find(d => d.id === districtId);
      return district ? district.name : `区${districtId}`; // Fallback to 'District X' if not found
    };

 export default function EditProfilePage() {
    // Filter buildings by district for the picker
      const getBuildingsForDistrict = (districtId) => buildings.filter(b => b.district === districtId);
  
  const [displayName, setDisplayName] = useState('');
  const [addresses, setAddresses] = useState([]); // Array to store user's addresses
  const [currentAddress, setCurrentAddress] = useState({ // State for the address being added/edited
    district: null, // Will be a number from DISTRICT_OPTIONS
    building: '',
    unitDetails: ''
  });
  const [editingAddressIndex, setEditingAddressIndex] = useState(null); // Index of the address being edited

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const [initialUserData, setInitialUserData] = useState(null); // Store original data to check for changes

  // Helper function to handle authentication errors and redirect
  const handleAuthError = useCallback(() => {
    console.warn('Authentication failed, redirecting to login...');
    Taro.removeStorageSync('authToken'); // Clear invalid token
    Taro.removeStorageSync('userId'); // Clear other user info
    Taro.redirectTo({ url: '/pages/user/login' }); // Redirect to login page
  }, []); // No dependencies

  // Effect to fetch initial user data when the page loads
  useEffect(() => {
    const fetchProfileData = async () => {
      setIsLoading(true);
      setError(null);

      const authToken = Taro.getStorageSync('authToken');
      if (!authToken) {
        console.log('No auth token found, redirecting to login from Edit Profile.');
        Taro.showToast({ title: '请登录以编辑资料', icon: 'none' }); // Translate: Please login to edit profile
        setTimeout(() => {
          handleAuthError();
        }, 1500);
        return;
      }

      try {
        const response = await Taro.request({
          url: API_BASE_URL +  `/api/auth/profile`,
          method: 'GET',
          header: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        if (response.statusCode === 200 && response.data && response.data.user) {
          const userData = response.data.user;
          setDisplayName(userData.displayName || '');
          setAddresses(userData.addresses || []); // Set fetched addresses
          setInitialUserData(userData); // Store initial data
          console.log('Fetched user data for editing:', userData);
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          handleAuthError();
        } else {
          console.error(`Failed to fetch profile data: Status ${response.statusCode}`, response.data);
          setError('加载个人资料失败.'); // Translate: Failed to load profile data
          Taro.showToast({ title: '加载个人资料失败', icon: 'none' });
        }
      } catch (err) {
        console.error('Network error fetching profile data:', err);
        setError('网络错误，无法加载个人资料.'); // Translate: Network error loading profile
        Taro.showToast({ title: '网络错误', icon: 'none' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfileData();

  }, [handleAuthError]); // Dependency on handleAuthError

  // Helper to check if addresses array has changed for optimistic update check
  const areAddressesEqual = (arr1, arr2) => {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i) {
      // Simple stringify comparison for embedded documents.
      // For production, consider a more robust deep comparison if order doesn't matter
      // or if properties might be undefined vs null for equality.
      if (JSON.stringify(arr1[i]) !== JSON.stringify(arr2[i])) {
        return false;
      }
    }
    return true;
  };

  // Function to handle adding a new address
  const handleAddUpdateAddress = () => {
    // Basic validation
    if (currentAddress.district === null || !currentAddress.building.trim()) {
      Taro.showToast({ title: '区和楼栋为必填项', icon: 'none' }); // Translate: District and Building are required
      return;
    }

    const newAddress = {
      district: currentAddress.district,
      building: currentAddress.building.trim(),
      unitDetails: currentAddress.unitDetails.trim(),
    };

    let updatedAddresses;
    if (editingAddressIndex !== null) {
      // Update existing address
      updatedAddresses = [...addresses];
      updatedAddresses[editingAddressIndex] = newAddress;
      setEditingAddressIndex(null); // Exit edit mode
    } else {
      // Add new address
      updatedAddresses = [...addresses, newAddress];
    }
    setAddresses(updatedAddresses);
    setCurrentAddress({ district: null, building: '', unitDetails: '' }); // Clear form
    Taro.showToast({ title: '地址已添加/更新，请点击保存更改', icon: 'none' }); // Translate: Address added/updated, please click save changes
  };

  // Function to start editing an address
  const startEditAddress = (index) => {
    setEditingAddressIndex(index);
    setCurrentAddress({ ...addresses[index] }); // Populate form with existing address data
  };

  // Function to cancel editing
  const cancelEditAddress = () => {
    setEditingAddressIndex(null);
    setCurrentAddress({ district: null, building: '', unitDetails: '' });
  };

  // Function to handle removing an address
  const handleRemoveAddress = async (index) => {
    const confirm = await Taro.showModal({
      title: '确认删除', // Translate: Confirm Delete
      content: '确定要删除此地址吗？', // Translate: Are you sure you want to delete this address?
      confirmText: '确定',
      cancelText: '取消',
    });

    if (confirm.confirm) {
      const updatedAddresses = addresses.filter((_, i) => i !== index);
      setAddresses(updatedAddresses);
      Taro.showToast({ title: '地址已删除，请点击保存更改', icon: 'none' }); // Translate: Address deleted, please click save changes
      // If the deleted address was being edited, clear the edit form
      if (editingAddressIndex === index) {
        cancelEditAddress();
      }
    }
  };


  // Function to handle saving the profile changes
  const handleSaveProfile = async () => {
    setIsSaving(true);
    setError(null);

    if (!displayName.trim()) {
      setError('显示名称不能为空.'); // Translate: Display name cannot be empty
      Taro.showToast({ title: '显示名称不能为空', icon: 'none' });
      setIsSaving(false);
      return;
    }

    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      console.log('No auth token found on save, preventing save.');
      setError('您必须登录才能保存个人资料.'); // Translate: You must be logged in to save profile
      Taro.showToast({ title: '请登录以保存', icon: 'none' });
      setIsSaving(false);
      return;
    }

    const updatedData = {
      displayName: displayName.trim(),
      addresses: addresses // Send the entire updated addresses array
    };

    // Check if data has actually changed before saving
    const displayNameChanged = initialUserData?.displayName !== updatedData.displayName;
    const addressesChanged = !areAddressesEqual(initialUserData?.addresses || [], updatedData.addresses || []);

    if (!displayNameChanged && !addressesChanged) {
      console.log('No changes detected, skipping save.');
      Taro.showToast({ title: '没有要保存的更改', icon: 'none' }); // Translate: No changes to save
      setIsSaving(false);
      return;
    }

    try {
      const response = await Taro.request({
        url: API_BASE_URL + `/api/auth/profile`,
        method: 'PUT',
        header: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: updatedData,
      });

      if (response.statusCode === 200) {
        console.log('Profile updated successfully:', response.data);
        Taro.showToast({
          title: '个人资料已更新！', // Translate: Profile updated!
          icon: 'success',
          duration: 2000,
        });
        // Update initialUserData to reflect new saved state
        setInitialUserData({ ...initialUserData, ...updatedData });
        setTimeout(() => {
          Taro.navigateBack();
        }, 1500);
      } else if (response.statusCode === 401 || response.statusCode === 403) {
        handleAuthError();
      } else {
        console.error(`Failed to save profile: Status ${response.statusCode}`, response.data);
        const errorMessage = response.data?.message || '保存个人资料失败.'; // Translate: Failed to save profile
        setError(errorMessage);
        Taro.showToast({ title: errorMessage, icon: 'none' });
      }
    } catch (err) {
      console.error('Network error saving profile:', err);
      setError('网络错误，无法保存个人资料.'); // Translate: Network error saving profile
      Taro.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      setIsSaving(false);
    }
  };


  // --- Conditional Rendering ---

  if (isLoading) {
    return <View className="edit-profile-page"><Text>加载个人资料...</Text></View>; // Translate: Loading profile data
  }

  return (
    <View className="edit-profile-page">
      <Text className="page-title">编辑个人资料</Text> {/* Translate: Edit Profile */}

      {error && <Text className='error-message'>{error}</Text>}

      {/* Display Name Input */}
      <View className='input-container'>
        <Text className="input-label">显示名称:</Text> {/* Translate: Display Name */}
        <Input
          className='input-field'
          type='text'
          placeholder='输入您的显示名称' // Translate: Enter your display name
          value={displayName}
          onInput={(e) => setDisplayName(e.detail.value)}
          disabled={isSaving}
        />
      </View>

      {/* Address Management Section */}
      <View className="section address-management-section">
        <Text className="section-title">我的地址</Text> {/* Translate: My Addresses */}

        {/* List of Existing Addresses */}
        {addresses.length > 0 ? (
          <View className="address-list">
            {addresses.map((addr, index) => (
              <View key={index} className="address-item">
                <Text className="address-text">
                  {getDistrictDisplayName(addr.district)} - 楼 {getBuildingNameById(addr.building)}
                  {addr.unitDetails ? ` - 单元 ${addr.unitDetails}` : ''}
                </Text>
                <View className="address-actions">
                  <Button className="action-button edit-small-button" size="mini" onClick={() => startEditAddress(index)}>编辑</Button> {/* Translate: Edit */}
                  <Button className="action-button remove-small-button" size="mini" onClick={() => handleRemoveAddress(index)}>删除</Button> {/* Translate: Delete */}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text className="no-addresses-text">您还没有添加任何地址。</Text> // Translate: You haven't added any addresses yet.
        )}

        {/* Add/Edit Address Form */}
        <View className="add-edit-address-form">
          <Text className="form-title">
            {editingAddressIndex !== null ? '编辑地址' : '添加新地址'} {/* Translate: Edit Address / Add New Address */}
          </Text>
          <View className='input-container'>
            <Text className="input-label">区:</Text> {/* Translate: District */}
            <Picker
              mode='selector'
              range={DISTRICT_OPTIONS}
              rangeKey='name'
              value={DISTRICT_OPTIONS.findIndex(d => d.id === currentAddress.district)}
              onChange={(e) => setCurrentAddress({ ...currentAddress, district: DISTRICT_OPTIONS[e.detail.value].id })}
              disabled={isSaving}
            >
              <View className='picker-input-field'>
                <Text>{currentAddress.district ? DISTRICT_OPTIONS.find(d => d.id === currentAddress.district)?.name : '请选择区'}</Text> {/* Translate: Please select district */}
              </View>
            </Picker>
          </View>
          <View className='input-container'>
            <Text className="input-label">楼栋:</Text> {/* Translate: Building */}
                      {currentAddress.district ? (
                          <Picker
                          mode= 'selector'
                          range={getBuildingsForDistrict(currentAddress.district)}
                          rangeKey='name'
                          value={currentAddress.building ? getBuildingsForDistrict(currentAddress.district).findIndex(b => b.buildingId === currentAddress.building) : -1}
                          onChange={(e) => {
                              const selectedBuilding = getBuildingsForDistrict(currentAddress.district)[e.detail.value];
                              setCurrentAddress({ ...currentAddress, building: selectedBuilding ? selectedBuilding.buildingId : '' });
                            }}
                          disabled={isSaving}
                          >
                          <View className='picker-input-field'>
                              <Text>{currentAddress.building ? getBuildingNameById(currentAddress.building) : '请选择楼号 (必填)'}</Text>
                            </View>
                        </Picker>
                    ) : (
                      <Input // Disabled placeholder if no district selected
                className='input-field'
                        placeholder='请先选择区域'
                        disabled={true}
              />
            )}
          </View>
          <View className='input-container'>
            <Text className="input-label">单元详情 (可选):</Text> {/* Translate: Unit Details (optional) */}
            <Input
              className='input-field'
              type='text'
              placeholder='例如: 单元501, 房间302' // Translate: e.g., Unit 501, Room 302
              value={currentAddress.unitDetails}
              onInput={(e) => setCurrentAddress({ ...currentAddress, unitDetails: e.detail.value })}
              disabled={isSaving}
            />
          </View>
          <View className="form-actions">
            <Button
              className='action-button primary'
              onClick={handleAddUpdateAddress}
              disabled={isSaving}
            >
              {editingAddressIndex !== null ? '更新地址' : '添加地址'} {/* Translate: Update Address / Add Address */}
            </Button>
            {editingAddressIndex !== null && (
              <Button className="action-button secondary" onClick={cancelEditAddress} disabled={isSaving}>
                取消
              </Button>
            )}
          </View>
        </View>
      </View>

      {/* Save Button */}
      <Button
        className='save-button'
        onClick={handleSaveProfile}
        loading={isSaving}
        disabled={isSaving}
      >
        {isSaving ? '正在保存...' : '保存更改'} {/* Translate: Saving... / Save Changes */}
      </Button>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: "编辑资料", // Set page title
});
