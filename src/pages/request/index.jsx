import React, { useState, useEffect, definePageConfig, useRef } from "react";
import {
  View,
  Text,
  Input,
  Picker,
  Textarea,
  Button,
  Switch, // Ensure Switch is imported for door delivery
  Image,  // Ensure Image is imported for media previews
  Label
} from "@tarojs/components";
import { AtRadio } from 'taro-ui';
import { differenceInDays, parseISO, addDays, addWeeks, addMonths, isValid, parse, format } from 'date-fns';
import Taro from "@tarojs/taro";
import { buildings, getBuildingNameById } from '../../data/buildings'; // Import buildings data and helper
import { isOutsidePeakPeriod } from '../../utils/isOutsidePeakPeriod';
import { searchBuildings } from '../../utils/fuzzySearch';
import './index.scss';
import AddressSelector from '../../components/request/AddressSelector';


// Define the array of available resource types for the picker
const types = [
  { value: 'buy', label: '求助' },
  { value: 'sell', label: '帮忙' },
  { value: 'rent', label: '租用' },
  { value: 'lease', label: '出租' },
  { value: 'service-request', label: '跑腿求助' },
  { value: 'service-offer', label: '跑腿帮忙' }
];

// Helper constants and functions for districts based on AddressSchema enum [1, 2, 3, 4]
const districtDisplayNames = ['北区', '东区', '南区', '东南区']; // Example Chinese names
const districtNumericalValues = [1, 2, 3, 4];

const getDistrictDisplayName = (num) => {
  const index = districtNumericalValues.indexOf(num);
  return index !== -1 ? districtDisplayNames[index] : '选择区域'; // Default display if not found
};

const getDistrictNumericalValue = (displayName) => {
  const index = districtDisplayNames.indexOf(displayName);
  return index !== -1 ? districtNumericalValues[index] : null; // Return null if not found
};

// Helper to get current time in HH:MM format
const getCurrentHHMM = () => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

// Helper function to calculate total days based on period quantity and unit
// This is useful when durationInputMode is 'period'
const getDaysFromPeriod = (quantity, unit, fromDateStr) => {
  const fromDate = parseISO(fromDateStr);
  if (!quantity || !unit || !isValid(fromDate)) return 0;

  const numQuantity = parseInt(quantity, 10);
  if (isNaN(numQuantity) || numQuantity <= 0) return 0;

  let calculatedEndDate;
  if (unit === '天') { // Days
    calculatedEndDate = addDays(fromDate, numQuantity);
  } else if (unit === '周') { // Weeks
    calculatedEndDate = addWeeks(fromDate, numQuantity);
  } else if (unit === '月') { // Months
    calculatedEndDate = addMonths(fromDate, numQuantity);
  } else {
    return 0; // Invalid unit
  }

  return differenceInDays(calculatedEndDate, fromDate);
};

// Helper function to get label from type value
const getTypeLabel = (typeValue) => {
  const typeObj = types.find(t => t.value === typeValue);
  return typeObj ? typeObj.label : '';
};

// Add these helper functions after the existing helper functions at the top
const isValidDateString = (dateStr) => {
  // Check if the string matches YYYY-MM-DD format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const date = new Date(dateStr);
  return date instanceof Date && !isNaN(date);
};

const formatDateForInput = (dateStr) => {
  if (!dateStr) return '';
  return dateStr;
};

// Add this helper function near the other helper functions at the top
const getCurrentDate = () => {
  const now = new Date();
  return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
};

// Add this helper function near the other helper functions
const getUnitSuffix = (rentalUnit) => {
  switch(rentalUnit) {
    case '每天': return '天';
    case '每周': return '周';
    case '每月': return '月';
    default: return '天';
  }
};

// Add this helper to strip the unit suffix from the input
const stripUnitSuffix = (value) => {
  return value.replace(/[天周月]$/, '');
};

// Helper function to get display text for an address
const getDisplayText = (address) => {
  if (!address?.building) return '';
  const buildingName = getBuildingNameById(address.building);
  const unitText = address.unitDetails ? ` • ${address.unitDetails}` : '';
  return `${buildingName}${unitText}`;
};

// Add these helper functions near the top with other helpers
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  try {
    // Try to parse the date string in various formats
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  } catch (e) {
    return dateStr;
  }
};

// Replace parseDateInput with a date-fns based version
const parseDateInput = (input) => {
  if (!input) return '';
  const now = new Date();
  const parts = input.trim().split(/[-./\s]/).filter(Boolean);
  let date;
  if (parts.length === 3) {
    let year = parts[0];
    if (year.length === 2) year = '20' + year;
    date = parse(`${year}-${parts[1]}-${parts[2]}`, 'yyyy-MM-dd', now);
    if (!isValid(date)) {
      // Try DD-MM-YY or DD-MM-YYYY
      let altYear = parts[2];
      if (altYear.length === 2) altYear = '20' + altYear;
      date = parse(`${altYear}-${parts[1]}-${parts[0]}`, 'yyyy-MM-dd', now);
    }
  } else if (parts.length === 2) {
    date = parse(`${now.getFullYear()}-${parts[0]}-${parts[1]}`, 'yyyy-MM-dd', now);
  } else if (parts.length === 1) {
    date = parse(`${now.getFullYear()}-${now.getMonth() + 1}-${parts[0]}`, 'yyyy-MM-dd', now);
  } else {
    return input;
  }
  if (isValid(date)) {
    return format(date, 'yyyy-MM-dd');
  }
  return input;
};

export default function Request() {

  const [resourceId, setResourceId] = useState(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("1"); // Default price to '1' as requested
  const [type, setType] = useState("buy");
  const [media, setMedia] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Add useEffect to check for stored type
  useEffect(() => {
    const pendingType = Taro.getStorageSync('pendingRequestType');
    if (pendingType) {
      setType(pendingType);
      // Clear the stored type after using it
      Taro.removeStorageSync('pendingRequestType');
    }
  }, []); // Empty dependency array means this runs once when component mounts

  // NEW: States for managing request presets
  const [savedPresets, setSavedPresets] = useState([]);

  // States for lease/rent case
  const [durationInputMode, setDurationInputMode] = useState('toDate');
  const [periodQuantity, setPeriodQuantity] = useState(''); // e.g., "3" (number of days/weeks/months)
  const [periodUnit, setPeriodUnit] = useState('天'); // e.g., '天' (Days), '周' (Weeks), '月' (Months)
  const [fromTime, setFromTime] = useState(''); // Format "YYYY-MM-DD" for date picker
  const [toTime, setToTime] = useState('');   // Format "YYYY-MM-DD" for date picker

  // New states for the rental item's rate and duration input method
  const [rentalRate, setRentalRate] = useState(''); // e.g., "100", this is the numerical rate
  const [rentalUnit, setRentalUnit] = useState('每天'); // e.g., '每天' (Per Day), '每周' (Per Week), '每月' (Per Month)

  // New state to store the calculated total rental price of the item itself
  const [calculatedTotalRentalPrice, setCalculatedTotalRentalPrice] = useState(0);

  // Updated states for errand addresses (matching AddressSchema: district, building, unitDetails)
  // Note: district is initially null, will be set to a number [1,2,3,4]
  const [fromAddress, setFromAddress] = useState({ district: null, building: '', unitDetails: '' });
  const [toAddress, setToAddress] = useState({ district: null, building: '', unitDetails: '' });
  const [resourceDeliveryAddress, setResourceDeliveryAddress] = useState({ district: null, building: '', unitDetails: '', });

  // New state for user's saved addresses, fetched from user profile
  const [userAddresses, setUserAddresses] = useState([]);

  // Add back the buildingSearchResults state
  const [buildingSearchQueries, setBuildingSearchQueries] = useState({
    from: '',
    to: '',
    resource: ''
  });
  const [buildingSearchResults, setBuildingSearchResults] = useState({
    input: [],
    select: buildings // Initialize select mode with all buildings
  });

  // Replace the single addressInputMode state with a map
  const [addressInputModes, setAddressInputModes] = useState({
    from: 'select',
    to: 'select',
    resource: 'select'
  });

  // Add new state for default address
  const [defaultAddress, setDefaultAddress] = useState(null);

  // New states for errand specific details (time options, doorDelivery, doorUnits, tips)
  const [timeMode, setTimeMode] = useState('off'); // 'off', 'starting', or 'arrival'
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');

  // States for door delivery
  const [fromDoorDelivery, setFromDoorDelivery] = useState(false);
  const [toDoorDelivery, setToDoorDelivery] = useState(false);
  const [fromDoorUnits, setFromDoorUnits] = useState('');
  const [toDoorUnits, setToDoorUnits] = useState('');
  const [fromDoorTime, setFromDoorTime] = useState('');
  const [toDoorTime, setToDoorTime] = useState('');

  const [currentTime, setCurrentTime] = useState(() => getCurrentHHMM());

  const [isErrandPrefilled, setIsErrandPrefilled] = useState(false); // Flag if errand was prefilled

  const isCurrentTypeErrand = type === 'service-request' || type === 'service-offer';
  const isCurrentTypeLeaseOrRent = ['lease', 'rent'].includes(type);

  // Add new state for type dropdown
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showRentalUnitDropdown, setShowRentalUnitDropdown] = useState(false);
  const [showPeriodUnitDropdown, setShowPeriodUnitDropdown] = useState(false);
  const [tips, setTips] = useState('');

  // Time slots for door delivery
  const timeSlots = [
    '08:00-10:00',
    '10:00-12:00',
    '12:00-14:00',
    '14:00-16:00',
    '16:00-18:00',
    '18:00-20:00',
    '20:00-22:00'
  ];

  // Replace the complex dropdown states with a single active dropdown tracker
  const [activeDropdown, setActiveDropdown] = useState(null);

  // Add new state for time dropdowns
  const [activeTimeDropdown, setActiveTimeDropdown] = useState(null);

  // Add at the top with other state declarations
  const [justClickedResult, setJustClickedResult] = useState(false);

  // Add at the top with other state declarations
  const [queryWasModified, setQueryWasModified] = useState(false);

  // Add near other state declarations
  const isSelectingRef = useRef(false);

  // Add these states at the top of the component
  const [showFromTimePicker, setShowFromTimePicker] = useState(false);
  const [showToTimePicker, setShowToTimePicker] = useState(false);

  // Add these states at the top of the component
  const [fromTimePlaceholder, setFromTimePlaceholder] = useState('开始日期');
  const [toTimePlaceholder, setToTimePlaceholder] = useState('结束日期');

  // Update handleBuildingSearch to use the new activeDropdown state
  const handleBuildingSearch = (addressType, query) => {
    setBuildingSearchQueries(prev => ({
      ...prev,
      [addressType]: query
    }));
    
    // Always show results, even when query is empty
    const results = query.trim() ? searchBuildings(query, buildings) : buildings;
    setBuildingSearchResults(prev => ({
      ...prev,
      input: results
    }));
    setActiveDropdown(`${addressType}-search`);
  };

  // Add this helper function near the other handlers
  const handleAddressSearchSelect = (addressType, building) => {
    isSelectingRef.current = true;
    handleBuildingSelect(addressType, building);
    setBuildingSearchQueries(prev => ({
      ...prev,
      [addressType]: building.name
    }));
    setActiveDropdown(null);
  };

  // Add this handler for switching to input mode
  const handleSwitchToInput = (addressType) => {
    setAddressInputModes(prev => ({
      ...prev,
      [addressType]: 'input'
    }));
    
    // Pre-fill the search query with current building name when switching modes
    let buildingName = '';
    if (addressType === 'from' && fromAddress.building) {
      buildingName = getBuildingNameById(fromAddress.building);
    } else if (addressType === 'to' && toAddress.building) {
      buildingName = getBuildingNameById(toAddress.building);
    } else if (addressType === 'resource' && resourceDeliveryAddress.building) {
      buildingName = getBuildingNameById(resourceDeliveryAddress.building);
    }

    if (buildingName) {
      setBuildingSearchQueries(prev => ({
        ...prev,
        [addressType]: buildingName
      }));
      // Perform the search with the building name
      const results = searchBuildings(buildingName, buildings);
      setBuildingSearchResults(prev => ({
        ...prev,
        input: results
      }));
    } else {
      // If no building name, show all buildings
      setBuildingSearchResults(prev => ({
        ...prev,
        input: buildings
      }));
    }
  };

  const renderAddressSearch = (addressType, currentAddress) => {
    const currentInputMode = addressInputModes[addressType];
    const isDropdownVisible = activeDropdown === addressType;
    const isSearchDropdownVisible = activeDropdown === `${addressType}-search`;
    const showDistrict = currentAddress.district && !isSearchDropdownVisible;
    const districtName = currentAddress.district ? getDistrictDisplayName(currentAddress.district) : '';

    const getPlaceholderText = (isInputMode) => {
      if (isInputMode) {
        if (addressType === 'resource') {
          return '请输入送货地址';
        }
        return addressType === 'from' ? '请输入起点地址' : '请输入终点地址';
      } else {
        let baseText = '';
        if (addressType === 'resource') {
          baseText = '请选择送货地址';
        } else {
          baseText = addressType === 'from' ? '请选择起点地址' : '请选择终点地址';
        }

        if (defaultAddress) {
          const buildingName = getBuildingNameById(defaultAddress.building);
          const unitText = defaultAddress.unitDetails ? ` ${defaultAddress.unitDetails}` : '';
          return `${baseText}（默认：${buildingName}${unitText}）`;
        }
        return baseText;
      }
    };

    return (
      <View className={`address-search-container ${currentInputMode === 'input' ? 'input-mode' : 'select-mode'}`}>
        {currentInputMode === 'select' ? (
          <>
            <View 
              className="select-input-container"
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
            >
              <Input
                className={`building-search-input ${showDistrict ? 'with-district' : ''}`}
                type="text"
                placeholder={getPlaceholderText(false)}
                value={currentAddress.building ? getDisplayText(currentAddress) : ''}
                disabled
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveDropdown(activeDropdown === addressType ? null : addressType);
                }}
              />
              {showDistrict && (
                <View className="district-display with-arrow">
                  {districtName}
                </View>
              )}
              <View className={`dropdown-indicator ${isDropdownVisible ? 'active' : ''}`} />
            </View>
            {isDropdownVisible && (
              <View 
                className="address-dropdown-container"
                catchMove
              >
                <View className="address-dropdown">
                  {defaultAddress && (
                    <View
                      className="saved-address-item default-address"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSavedAddressSelect(addressType, defaultAddress);
                        setActiveDropdown(null);
                      }}
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
                  {userAddresses
                    .filter(addr => !addr.isDefault)
                    .map((address, index) => (
                      <View
                        key={index}
                        className="saved-address-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSavedAddressSelect(addressType, address);
                          setActiveDropdown(null);
                        }}
                      >
                        <View className="address-details">
                          <Text className="address-name">
                            {getBuildingNameById(address.building)}
                          </Text>
                          {address.unitDetails && (
                            <Text className="unit-details">{address.unitDetails}</Text>
                          )}
                          <Text className="district-name">
                            {getDistrictDisplayName(address.district)}
                          </Text>
                        </View>
                      </View>
                    ))}
                  <View
                    className="input-other-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      Taro.navigateTo({
                        url: '/pages/user/edit/index'
                      });
                    }}
                  >
                    <Text>管理地址</Text>
                  </View>
                  <View
                    className="input-other-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSwitchToInput(addressType);
                    }}
                  >
                    <Text>选择其他地址</Text>
                  </View>
                </View>
              </View>
            )}

            {/* Add overlay for address select dropdown */}
            {isDropdownVisible && (
              <View
                className="dropdown-overlay"
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 998
                }}
                onClick={() => setActiveDropdown(null)}
              />
            )}
          </>
        ) : (
          <>
            <View 
              className="manual-input-container"
              bindtap={(e) => {
                // Prevent closing if clicking inside the input container
                e.stopPropagation();
              }}
            >
              <View 
                className="input-wrapper"
                catchTap={(e) => {
                  e.stopPropagation();
                }}
              >
                <View 
                  className="input-field-container"
                  catchTap={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <Input
                    className={`building-search-input ${showDistrict ? 'with-district' : ''}`}
                    type="text"
                    placeholder={getPlaceholderText(true)}
                    value={buildingSearchQueries[addressType]}
                    onInput={e => {
                      isSelectingRef.current = false;
                      const query = e.detail.value;
                      setQueryWasModified(true); // Mark that user modified the query
                      setBuildingSearchQueries(prev => ({
                        ...prev,
                        [addressType]: query
                      }));
                      
                      if (query.trim()) {
                        const results = searchBuildings(query, buildings);
                        setBuildingSearchResults(prev => ({
                          ...prev,
                          input: results
                        }));
                      } else {
                        setBuildingSearchResults(prev => ({
                          ...prev,
                          input: buildings
                        }));
                      }
                      setActiveDropdown(`${addressType}-search`);
                    }}
                    onFocus={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setQueryWasModified(false); // Reset modification flag on new focus
                      setBuildingSearchResults(prev => ({
                        ...prev,
                        input: buildings
                      }));
                      setActiveDropdown(`${addressType}-search`);
                    }}
                    onBlur={(e) => {
                      setTimeout(() => {
                        // Skip restoration if we just selected
                        if (isSelectingRef.current) {
                          isSelectingRef.current = false;
                          return;
                        }

                        let currentAddress;
                        if (addressType === 'from') {
                          currentAddress = fromAddress;
                        } else if (addressType === 'to') {
                          currentAddress = toAddress;
                        } else {
                          currentAddress = resourceDeliveryAddress;
                        }

                        if (currentAddress.building) {
                          const buildingName = getBuildingNameById(currentAddress.building);
                          setBuildingSearchQueries(prev => ({
                            ...prev,
                            [addressType]: buildingName
                          }));
                        }
                        setActiveDropdown(null);
                      }, 200);
                    }}
                    onKeyDown={(e) => {
                      if (e.keyCode === 13) { // Enter key
                        const query = e.detail.value;
                        if (query && buildingSearchResults.input.length > 0 && !currentAddress.building) {
                          handleAddressSearchSelect(addressType, buildingSearchResults.input[0]);
                        }
                      }
                    }}
                  />
                  {showDistrict && (
                    <View className="district-display">
                      {districtName}
                    </View>
                  )}
                </View>
                <View 
                  className="back-to-select-button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setAddressInputModes(prev => ({
                      ...prev,
                      [addressType]: 'select'
                    }));
                    setBuildingSearchQueries(prev => ({
                      ...prev,
                      [addressType]: ''
                    }));
                    setBuildingSearchResults(prev => ({
                      ...prev,
                      input: []
                    }));
                    setActiveDropdown(null);
                  }}
                />
              </View>
            </View>

            {isSearchDropdownVisible && (
              <View 
                className="search-results-container"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <View className="building-search-results">
                  {buildingSearchResults.input.map((building, index) => (
                    <View
                      key={index}
                      className={`building-result-item ${building.buildingId === currentAddress.building ? 'current-selection' : ''}`}
                      onMouseDown={(e) => {
                        // Prevent blur from firing before click
                        e.preventDefault();
                      }}
                      onClick={() => {
                        handleAddressSearchSelect(addressType, building);
                      }}
                    >
                      <Text className="building-name">
                        {building.name}
                        {building.buildingId === currentAddress.building && (
                          <Text className="current-tag">当前选择</Text>
                        )}
                      </Text>
                      <Text className="district-name">
                        {getDistrictDisplayName(building.district)}
                      </Text>
                    </View>
                  ))}
                  {buildingSearchResults.input.length === 0 && (
                    <View className="no-results">
                      <Text>未找到相关建筑物</Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </>
        )}
      </View>
    );
  };

  // Add click outside handler to close all dropdowns
  useEffect(() => {
    const handleClickOutside = (e) => {
      const searchContainer = e.target.closest('.address-search-container');
      const dropdownContainer = e.target.closest('.address-dropdown-container');
      const typeDropdown = e.target.closest('.type-dropdown-container');
      const timeSelector = e.target.closest('.time-selector-container');

      // Handle type dropdown
      if (!typeDropdown) {
        setShowTypeDropdown(false);
      }

      // Handle address dropdowns
      if (!searchContainer && !dropdownContainer) {
        setActiveDropdown(null);
      }

      if (!timeSelector) {
        setActiveTimeDropdown(null);
      }
    };

    Taro.eventCenter.on('page:click', handleClickOutside);
    return () => {
      Taro.eventCenter.off('page:click', handleClickOutside);
    };
  }, [activeDropdown, activeTimeDropdown]);

  // Add handler for type selection
  const handleTypeSelect = (selectedType) => {
    // Reset all states before changing type
    setFromAddress({ district: null, building: '', unitDetails: '' });
    setToAddress({ district: null, building: '', unitDetails: '' });
    setFromDoorDelivery(false);
    setToDoorDelivery(false);
    setFromDoorTime('');
    setToDoorTime('');
    setFromDoorUnits('');
    setToDoorUnits('');
    setTimeMode('off');
    setStartTime('');
    setArrivalTime('');
    setFromTime('');
    setToTime('');
    setTips('');
    setPrice('1');
    setRentalRate('');
    setRentalUnit('每天');
    setDurationInputMode('toDate');
    setPeriodQuantity('');
    setPeriodUnit('天');
    setCalculatedTotalRentalPrice(0);
    setBuildingSearchQueries(prev => ({
      from: '',
      to: '',
      resource: ''
    }));

    // Finally set the new type
    setType(selectedType.value);
    setShowTypeDropdown(false);

    setAddressInputModes({
      from: 'select',
      to: 'select',
      resource: 'select'
    });
  };

  // Helper function to handle authentication errors and redirect
  const handleAuthError = () => {
    console.warn('Authentication failed, redirecting to login...');
    Taro.removeStorageSync('authToken');
    Taro.removeStorageSync('userId');
    Taro.redirectTo({ url: '/pages/user/login/index' });
  };

  // Handler for media file upload button click
  const handleMediaUpload = async () => {
    try {
      // Allow choosing up to the remaining limit (5 total files)
      const res = await Taro.chooseMedia({
        count: 5 - media.length,
        mediaType: ['image', 'video'],
        sourceType: ['album', 'camera'],
        maxDuration: 30, // Max video duration in seconds
        camera: 'back',
      });

      if (res.tempFiles && res.tempFiles.length > 0) {
        console.log('Selected media files:', res.tempFiles);
        // Map tempFiles to your media state format (tempFilePath, size, fileType)
        const newMediaItems = res.tempFiles.map(file => ({
          tempFilePath: file.tempFilePath,
          size: file.size,
          fileType: file.fileType, // 'image' or 'video'
        }));
        setMedia(prevMedia => [...prevMedia, ...newMediaItems]);
        Taro.showToast({
          title: `${res.tempFiles.length} file(s) selected`,
          icon: 'success',
          duration: 1000
        });
      } else {
        console.log('No media files selected.');
      }
    } catch (error) {
      console.error('Error choosing media:', error);
      if (error.errMsg && error.errMsg.includes('cancel')) {
        console.log('Media selection canceled by user.');
      } else {
        Taro.showToast({
          title: 'Failed to select media',
          icon: 'none',
          duration: 2000
        });
      }
    }
  };

  // Handler to remove a media file from the selected list
  const handleRemoveMedia = (indexToRemove) => {
    console.log('Removing media file at index:', indexToRemove);
    setMedia(media.filter((_, index) => index !== indexToRemove));
    Taro.showToast({ title: 'Media removed', icon: 'none', duration: 1000 });
  };

  // Modified handler for dropdown toggle
  const handleDropdownToggle = (addressType, e) => {
    e.stopPropagation();
    
    if (addressInputModes[addressType] === 'select') {
      // Close all other dropdowns and toggle the current one
      setActiveDropdown(activeDropdown === addressType ? null : addressType);
    } else {
      setActiveDropdown(addressType);
    }
  };

  // Modified address selection handler
  const handleSavedAddressSelect = (addressType, savedAddress) => {
    const addressToSet = {
      district: savedAddress.district,
      building: savedAddress.building,
      unitDetails: savedAddress.unitDetails || ''  // Preserve unit details from saved address
    };
    
    if (addressType === 'from') {
      setFromAddress(addressToSet);
    } else if (addressType === 'to') {
      setToAddress(addressToSet);
    } else {
      setResourceDeliveryAddress(addressToSet);  // Keep unit details for resource too
    }

    // Set the search query to the selected building name
    const buildingName = getBuildingNameById(savedAddress.building);
    setBuildingSearchQueries(prev => ({
      ...prev,
      [addressType]: buildingName
    }));

    setActiveDropdown(null);
  };

  // Handler for "输入其他地址" option
  const handleInputOtherAddress = () => {
    setActiveDropdown(null);
    // Focus the input field
    const input = document.querySelector('.building-search-input');
    if (input) input.focus();
  };

  const handleBuildingSelect = (addressType, selectedBuilding) => {
    if (addressType === 'from') {
      setFromAddress(prev => ({
        ...prev,
        district: selectedBuilding.district,
        building: selectedBuilding.buildingId
      }));
    } else if (addressType === 'to') {
      setToAddress(prev => ({
        ...prev,
        district: selectedBuilding.district,
        building: selectedBuilding.buildingId
      }));
    } else if (addressType === 'resource') {
      setResourceDeliveryAddress(prev => ({
        ...prev,
        district: selectedBuilding.district,
        building: selectedBuilding.buildingId
      }));
    }
    
    // Set the search query to the selected building's name
    setBuildingSearchQueries(prev => ({
      ...prev,
      [addressType]: selectedBuilding.name
    }));
    
    // Close the results dropdown
    setActiveDropdown(null);
  };

  // Effect to calculate total rental price
  useEffect(() => {
    let currentCalculatedRentalPrice = 0; // Use a local variable for calculation
    const rate = parseFloat(rentalRate);

    // Only proceed if it's a lease/rent type, a valid rate is entered, and a start time is set
    if (isCurrentTypeLeaseOrRent && !isNaN(rate) && rate > 0 && fromTime) {
      const startDate = parseISO(fromTime); // Convert ISO date string (YYYY-MM-DD) to Date object

      if (!isValid(startDate)) {
        console.warn("Invalid start date for rental calculation.");
        setCalculatedTotalRentalPrice(0); // Reset price if date is invalid
        return;
      }

      let totalDays = 0;

      // Case 1: Duration based on From Time  To Time
      if (durationInputMode === 'toDate' && toTime) {
        const endDate = parseISO(toTime);
        if (!isValid(endDate) || endDate < startDate) {
          console.warn("Invalid end date or end date is before start date.");
          setCalculatedTotalRentalPrice(0); // Reset price if dates are invalid
          return;
        }
        totalDays = differenceInDays(endDate, startDate);

      }
      // Case 2: Duration based on From Time  Period
      else if (durationInputMode === 'period' && periodQuantity && periodUnit) {
        totalDays = getDaysFromPeriod(periodQuantity, periodUnit, fromTime);
        if (totalDays <= 0) {
          console.warn("Calculated total days from period is not positive.");
          setCalculatedTotalRentalPrice(0); // Reset price if period is invalid
          return;
        }
        // Optional: If you want the `toTime` state to reflect the calculated end date
        // const calculatedEndDate = addPeriodToDate(startDate, periodQuantity, periodUnit);
        // setToTime(formatISO(calculatedEndDate, { representation: 'date' })); // You'd need formatISO
      } else {
        // Not enough information to calculate the duration
        setCalculatedTotalRentalPrice(0);
        return;
      }

      // Calculate the price based on the rental unit and total days
      if (totalDays > 0) {
        if (rentalUnit === '每天') { // Per Day
          currentCalculatedRentalPrice = rate * totalDays;
        } else if (rentalUnit === '每周') { // Per Week
          // Pro-rata calculation for partial weeks (e.g., 10 days = 10/7 weeks)
          currentCalculatedRentalPrice = rate * (totalDays / 7);
        } else if (rentalUnit === '每月') { // Per Month
          // Pro-rata calculation for partial months.
          // Using an average of 30.44 days per month for calculation.
          // For very precise month calculations, handling leap years and actual days in months
          // can become complex, but 30.44 is a good practical average.
          currentCalculatedRentalPrice = rate * (totalDays / 30.44);
        }
      }

      // Round to two decimal places for currency display
      currentCalculatedRentalPrice = parseFloat(currentCalculatedRentalPrice.toFixed(2));
    }

    // Only update the state if the calculated value is different
    // This helps prevent unnecessary re-renders.
    if (currentCalculatedRentalPrice !== calculatedTotalRentalPrice) {
      setCalculatedTotalRentalPrice(currentCalculatedRentalPrice);
    }

    // Dependencies: Recalculate when any of these states change
  }, [rentalRate, rentalUnit, fromTime, toTime, durationInputMode, periodQuantity, periodUnit, isCurrentTypeLeaseOrRent, calculatedTotalRentalPrice]); // `calculatedTotalRentalPrice` is here for the comparison `if (currentCalculatedRentalPrice !== calculatedTotalRentalPrice)`

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(getCurrentHHMM());
    }, 60000); // Update every minute

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, []);

  useEffect(() => {
    const isErrandType = type === 'service-request' || type === 'service-offer';
    if (isErrandType) {
      let calculatedPrice = 0;

      // Ensure 'from' and 'to' addresses have district information before calculating
      if (fromAddress.district && toAddress.district) {
        // Calculate base minimum price
        calculatedPrice = fromAddress.district === toAddress.district ? 1 : 2;

        // Surcharge is ALWAYS based on the CURRENT CLIENT TIME for display
        const currentTimeForSurcharge = currentTime;
        if (isOutsidePeakPeriod(currentTimeForSurcharge)) {
          calculatedPrice *= 2;
        }

        // Add 3 for each door delivery
        if (fromDoorDelivery) {
          calculatedPrice += 3;
        }
        if (toDoorDelivery) {
          calculatedPrice += 3;
        }
      }

      if (parseFloat(price) !== calculatedPrice) {
        setPrice(calculatedPrice.toString());
        console.log('Calculated and setting price:', calculatedPrice);
      }
    } else {
      console.log('Clearing price for non-errand type.');
      setPrice('');
    }
    // Dependencies for useEffect: Now primarily depends on `type`, `from`, `to`, `doorDelivery`.
    // To make the price dynamic based on current time, you would need a `setInterval`
    // or similar mechanism to periodically update a state that `getCurrentHHMM` uses.
    // For simplicity here, it will only re-calculate when other dependencies change.
    // If live update based on time is crucial, consider adding a `timeUpdateTrigger` state
    // updated by a `setInterval`.
  }, [type, fromAddress, toAddress, fromDoorDelivery, toDoorDelivery, currentTime]);
  
  // Ensure uploadFiles function is defined within the component's scope
  // This function should loop through the 'media' state and call Taro.uploadFile
  // to upload each file, returning an array of file paths/names from the backend responses.
  const uploadFiles = async (resourceIdForUpdate = null) => {
    const uploadedMediaNames = [];
    const authToken = Taro.getStorageSync('authToken');

    if (!authToken) {
      console.error("Cannot upload files: Auth token missing.");
      throw new Error("Authentication token missing for file upload.");
    }

    // Assuming your backend has a dedicated media upload endpoint
    const uploadEndpoint = API_BASE_URL + '/api/resource/upload-media'; // Adjust endpoint as needed

    for (const file of media) { // Assuming 'media' state is accessible here
      console.log("Uploading file:", file.tempFilePath);
      try {
        const fileUploadRes = await Taro.uploadFile({
          url: uploadEndpoint,
          filePath: file.tempFilePath,
          name: 'media', // Field name expected by backend Multer upload.array('media', 5)
          header: {
            'Authorization': `Bearer ${authToken}`,
          },
          // Optional: send additional data with each file upload if backend requires it
          // formData: { resourceId: resourceIdForUpdate || 'new' },
        });

        if (fileUploadRes.statusCode >= 200 && fileUploadRes.statusCode < 300) {
          let fileResData;
          try {
            fileResData = typeof fileUploadRes.data === 'string' ? JSON.parse(fileUploadRes.data) : fileUploadRes.data;
          } catch (parseErr) {
            console.error("Failed to parse file upload response JSON:", parseErr, fileUploadRes.data);
            // Handle non-JSON response, maybe assume success and use a placeholder name
            fileResData = { filePath: file.tempFilePath.split('/').pop() || 'uploaded_file' };
          }

          if (fileResData && fileResData.filePath) { // Assuming backend returns filePath
            uploadedMediaNames.push(fileResData.filePath);
          } else {
            console.warn('File upload success but no file path returned:', fileResData);
            uploadedMediaNames.push(file.tempFilePath.split('/').pop() || 'uploaded_file_no_path');
          }
        } else {
          console.error('File upload failed:', fileUploadRes.statusCode, fileUploadRes.data);
          const uploadErrorMsg = fileUploadRes.data?.message || `Upload failed with status ${fileUploadRes.statusCode}`;
          throw new Error(`File upload failed for ${file.tempFilePath.split('/').pop()}: ${uploadErrorMsg}`);
        }
      } catch (fileErr) {
        console.error('Error during file upload:', fileErr);
        throw fileErr; // Re-throw the error to stop the main submission
      }
    }
    return uploadedMediaNames; // Return the collected paths
  };

    // NEW: Function to save the current form state as a preset
      const saveCurrentFormAsPreset = async () => {
          const { confirm, cancel, content: presetName } = await Taro.showModal({
  title: '保存预设',
              placeholderText: '请输入预设名称',
              editable: true,
              confirmText: '保存',
              cancelText: '取消'
          });
  
        if (confirm && presetName && presetName.trim()) {
            const newPreset = {
  id: Date.now(), // Simple unique ID
                name: presetName.trim(),
                  data: {
                  name, description, price, type,
                    fromAddress, toAddress, startTime, arrivalTime, fromDoorDelivery, toDoorDelivery,
                    durationInputMode, periodQuantity, periodUnit, fromTime, toTime,
                    rentalRate, rentalUnit,
                    // Note: Media files are not saved in presets as they are temporary or external URLs.
                  }
            };
  
          const updatedPresets = [...savedPresets, newPreset];
        setSavedPresets(updatedPresets);
        Taro.setStorageSync('userRequestPresets', JSON.stringify(updatedPresets));
        Taro.showToast({ title: '预设已保存', icon: 'success' });
      } else if (confirm && (!presetName || !presetName.trim())) {
          Taro.showToast({ title: '预设名称不能为空', icon: 'none' });
        }
  };

    // NEW: Function to apply a selected preset
    const applyPreset = (presetIndex) => {
        const selectedPreset = savedPresets[presetIndex];
        if (selectedPreset && selectedPreset.data) {
            const data = selectedPreset.data;
            setName(data.name || '');
            setDescription(data.description || '');
            setPrice(data.price || '1');
            setType(data.type || 'buy');
      
            // Apply errand-specific data
            setFromAddress(data.fromAddress || { district: null, building: '', unitDetails: '' });
            setToAddress(data.toAddress || { district: null, building: '', unitDetails: '' });

            // Apply time based on timeMode from preset data
            if (data.startTime) {
              setStartTime(data.startTime);
            }
            if (data.arrivalTime) {
              setArrivalTime(data.arrivalTime);
            }

            setFromDoorDelivery(data.fromDoorDelivery === true);
            setToDoorDelivery(data.toDoorDelivery === true);
      
              // Apply lease/rent-specific data
              setDurationInputMode(data.durationInputMode || 'toDate');
            setPeriodQuantity(data.periodQuantity || '');
            setPeriodUnit(data.periodUnit || '天');
            setFromTime(data.fromTime || '');
            setToTime(data.toTime || '');
            setRentalRate(data.rentalRate || '');
            setRentalUnit(data.rentalUnit || '每天');
      
              Taro.showToast({ title: `预设 "${selectedPreset.name}" 已应用`, icon: 'success' });
          }
      };

    // NEW: Function to delete a preset
    const deletePreset = async (presetId) => {
        const confirmDelete = await Taro.showModal({
  title: '删除预设',
            content: '确定要删除此预设吗？',
            confirmText: '删除',
            cancelText: '取消'
        });
    if (confirmDelete.confirm) {
        const updatedPresets = savedPresets.filter(p => p.id !== presetId);
        setSavedPresets(updatedPresets);
        Taro.setStorageSync('userRequestPresets', JSON.stringify(updatedPresets));
        Taro.showToast({ title: '预设已删除', icon: 'success' });
      }
  };
  
  const handleSubmit = async () => {
    setError(null);

      // Define type checks early
      const isCurrentTypeErrand = ['service-request', 'service-offer'].includes(type);
      const isCurrentTypeLeaseOrRent = ['lease', 'rent'].includes(type);

      let submissionPrice; // This variable will hold the final price to send in the payload
      let userSpecsPayload = {}; // This will hold the specifications for the backend

      // --- General Validation (Name, Description) ---
      if (!name || !description) {
        setError('请填写名称和描述。'); // Please fill in name and description.
        Taro.showToast({ title: '请填写必填字段', icon: 'none' });
        setIsSubmitting(false);
        return;
      }

      // --- Price/Rate Validation based on Type ---
      if (isCurrentTypeLeaseOrRent) {
        const parsedRentalRate = parseFloat(rentalRate);
        if (isNaN(parsedRentalRate) || parsedRentalRate <= 0) {
          setError('请填写有效的租赁/出租基本价格 (每单位)。'); // Please fill in a valid base rental/lease price (per unit).
          Taro.showToast({ title: '请填写有效租赁价格', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        if (!rentalUnit || !['每天', '每周', '每月'].includes(rentalUnit)) {
          setError('请选择租赁/出租价格单位 (每天/每周/每月)。'); // Please select a rental/lease price unit (per day/week/month).
          Taro.showToast({ title: '请选择价格单位', icon: 'none' });
          setIsSubmitting(false);
          return;
        }

        // Validation specific to Lease/Rent Dates/Period
        if (!fromTime) {
          setError('请选择租赁/出租的开始日期。'); // Please select the start date for lease/rent.
          Taro.showToast({ title: '请选择开始日期', icon: 'none' });
          setIsSubmitting(false);
          return;
        }

        if (durationInputMode === 'toDate') {
          if (!toTime) {
            setError('请选择租赁/出租的结束日期。'); // Please select the end date for lease/rent.
            Taro.showToast({ title: '请选择结束日期', icon: 'none' });
            setIsSubmitting(false);
            return;
          }
          if (new Date(fromTime) > new Date(toTime)) {
            setError('结束日期不能早于开始日期。'); // End date cannot be earlier than start date.
            Taro.showToast({ title: '日期范围错误', icon: 'none' });
            setIsSubmitting(false);
            return;
          }
        } else if (durationInputMode === 'period') {
          const parsedPeriodQuantity = parseInt(periodQuantity, 10);
          if (isNaN(parsedPeriodQuantity) || parsedPeriodQuantity <= 0) {
            setError('请填写有效的持续时间数量。'); // Please fill in a valid duration quantity.
            Taro.showToast({ title: '请填写有效数量', icon: 'none' });
            setIsSubmitting(false);
            return;
          }
          if (!periodUnit || !['天', '周', '月'].includes(periodUnit)) {
            setError('请选择持续时间单位 (天/周/月)。'); // Please select a duration unit (day/week/month).
            Taro.showToast({ title: '请选择时间单位', icon: 'none' });
            setIsSubmitting(false);
            return;
          }
        }

        // Use calculatedTotalRentalPrice for `price` field in payload
        if (calculatedTotalRentalPrice <= 0) {
          setError('总租赁费用必须大于0。'); // Total rental fee must be greater than 0.
          Taro.showToast({ title: '总租赁费用错误', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        submissionPrice = calculatedTotalRentalPrice;

        // Build userSpecs for Lease/Rent
        userSpecsPayload = {
          from_time: fromTime,
          duration_input_mode: durationInputMode,
          base_rental_rate: parseFloat(rentalRate), // Send numerical base rate
          base_rental_rate_unit: rentalUnit,
          delivery_address: resourceDeliveryAddress,
        };
        if (durationInputMode === 'toDate') {
          userSpecsPayload.to_time = toTime;
        } else if (durationInputMode === 'period') {
          userSpecsPayload.period_quantity = parseInt(periodQuantity, 10);
          userSpecsPayload.period_unit = periodUnit;
        }

      } else if (isCurrentTypeErrand) {
        // --- Validation specific to Errand case (mostly unchanged) ---
        if (!fromAddress.district || !fromAddress.building || !toAddress.district || !toAddress.building) {
          setError('请填写完整的取货和送货地址 (区域和楼号必填)。'); // Please fill in complete pickup and delivery addresses (district and building required).
          Taro.showToast({ title: '请填写完整的地址', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        // Validate based on selected time mode
        // NOTE: These validations are for user preference, not for surcharge
        if (timeMode === 'starting' && !startTime) {
          setError('请选择开始时间。'); // Please select starting time.
          Taro.showToast({ title: '请选择开始时间', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        if (timeMode === 'arrival' && !arrivalTime) {
          setError('请选择送达时间。'); // Please select arrival time.
          Taro.showToast({ title: '请选择送达时间', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        // If timeMode is 'off', startingTime is implicitly `getCurrentHHMM()` for storage,
        // but the price is already based on `getCurrentHHMM()

        const currentPriceNum = parseFloat(price);
        const tipsNum = parseFloat(tips || '0');
        if (isNaN(tipsNum) || tipsNum < 0) {
          throw new Error("附加小费必须是有效的数字且不能为负数。");
        }
        submissionPrice = currentPriceNum + tipsNum;

        // Build userSpecs for Errand
        userSpecsPayload = {
          from_address: {
            district: fromAddress.district,
            building: fromAddress.building,
            unitDetails: fromAddress.unitDetails || ''
          },
          to_address: {
            district: toAddress.district,
            building: toAddress.building,
            unitDetails: toAddress.unitDetails || ''
          },
          time_mode: timeMode,
          ...(timeMode === 'starting' && { starting_time: startTime }),
          ...(timeMode === 'arrival' && { arrival_time: arrivalTime }),
          ...(timeMode === 'off' && { starting_time: currentTime }),
          door_delivery: fromDoorDelivery || toDoorDelivery,
          current_time: currentTime,
          tips: tipsNum,
          from_door_units: fromDoorDelivery ? parseFloat(fromDoorUnits) || 0 : 0,
          to_door_units: toDoorDelivery ? parseFloat(toDoorUnits) || 0 : 0
        };
      } else {
        // --- Validation for other types (e.g., 'buy', 'sell') ---
        const currentPriceNum = parseFloat(price);
        if (isNaN(currentPriceNum) || currentPriceNum <= 0) {
          setError('请填写有效的价格。'); // Please fill in a valid price.
          Taro.showToast({ title: '请填写有效价格', icon: 'none' });
          setIsSubmitting(false);
          return;
        }
        submissionPrice = currentPriceNum;
        userSpecsPayload = {
          delivery_address: {
            district: resourceDeliveryAddress.district,
            building: resourceDeliveryAddress.building,
            unitDetails: resourceDeliveryAddress.unitDetails || ''
          }
        };
      }

    const authToken = Taro.getStorageSync('authToken');
    if (!authToken) {
      console.log('No auth token found, redirecting to login from Request page.');
      Taro.showToast({ title: 'Please login to create a request', icon: 'none' });
      setTimeout(() => {
        handleAuthError();
      }, 1500);
      return;
    }

    setIsSubmitting(true);

    // --- Construct a plain JavaScript object for form data ---
    const requestFormData = {
      name: name,
      description: description,
      type: type,
      userSpecs: JSON.stringify(userSpecsPayload), // Use the dynamically built userSpecsPayload
      price: submissionPrice, // Use the conditionally set submissionPrice
    };

    console.log("Frontend - Built specifications object:", userSpecsPayload);
    console.log("Frontend - Stringified userSpecs:", requestFormData.userSpecs);
    console.log("Frontend - Prepared requestFormData:", requestFormData);

    try {
      let requestUrl;
      let requestMethod;
      let response;

      if (resourceId) { // It's an EDIT (PUT) request
        requestUrl = API_BASE_URL + `/api/resource/${resourceId}`; // PUT endpoint
        requestMethod = 'PUT';

        let finalMediaPaths = [];
        if (media.length > 0) {
          console.log("Uploading new media for resource update...");
          // Assuming uploadFiles function handles Taro.uploadFile and returns an array of new media names/paths
          const uploaded = await uploadFiles(resourceId); // Pass resourceId if uploadFiles needs it for associating uploads
          finalMediaPaths = uploaded;
          requestFormData.media = finalMediaPaths; // Add the new media paths to the form data
        } else {
          // If no new media selected, and there were existing media, you might need to explicitly
          // send an empty array or a flag to the backend to clear them, depending on your PUT logic.
          // For now, if `media` is empty, we assume backend preserves existing unless told otherwise.
          // If you want to allow clearing media, send an empty array: requestFormData.media = [];
        }

        // Send the PUT request with the updated form data (as JSON body)
        response = await Taro.request({
          url: requestUrl,
          method: requestMethod,
          header: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json', // Indicate JSON body
          },
          data: requestFormData, // Send data as JSON
        });

      } else { // It's a CREATE (POST) request
        requestUrl = API_BASE_URL + "/api/resource"; // POST endpoint
        requestMethod = 'POST';

        console.log("Preparing to create resource with media handling...");

        if (media.length > 0) {
          // Option A (Recommended): Upload files FIRST, then send data  paths
          // Assuming uploadFiles returns an array of uploaded file names/paths
          const uploadedMediaNames = await uploadFiles();
          requestFormData.media = uploadedMediaNames; // Add collected file paths to form data

          // Then send the main resource data (including media paths) via a standard POST request (JSON body)
          response = await Taro.request({
            url: requestUrl,
            method: requestMethod,
            header: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json', // Indicate JSON body
            },
            data: requestFormData, // Send data (including media paths) as JSON
          });

        } else { // No media selected, just send data via Taro.request POST (JSON body)
          response = await Taro.request({
            url: requestUrl,
            method: requestMethod,
            header: {
              'Authorization': `Bearer ${authToken}`,
              'Content-Type': 'application/json',
            },
            data: requestFormData, // Send data as JSON
          });
        }
      }

      // --- Handle Response ---
      if (!response) {
        console.error("API request did not return a response object.");
        throw new Error("API request failed.");
      }

      let responseData;
      try {
        responseData = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
      } catch (e) {
        console.error("Failed to parse response data as JSON:", e, response.data);
        responseData = { message: `Received non-JSON response or parse error. Status: ${response.statusCode}` };
      }

      if (response.statusCode >= 200 && response.statusCode < 300) {
        const successMessage = resourceId ? '请求已成功更新！' : '请求已成功提交！';
        Taro.showToast({ title: successMessage, icon: 'success' });

        if (!resourceId) {
          setName("");
          setDescription("");
          setPrice("1"); // Reset to default price for 'buy' type
          setType("buy"); // Reset to default type
          setMedia([]); // Clear selected media
          setFromAddress({ district: null, building: '', unitDetails: '' });
          setToAddress({ district: null, building: '', unitDetails: '' });
          setFromTime('');
          setToTime('');
          setStartTime(''); // Ensure starting time is reset
          setArrivalTime('');   // Ensure arrival time is reset
          setFromDoorDelivery(false);
          setToDoorDelivery(false);
          setRentalRate(''); // Reset rental specific fields
          setRentalUnit('每天');
          setDurationInputMode('toDate');
          setPeriodQuantity('');
          setPeriodUnit('天');
          setCalculatedTotalRentalPrice(0); // Reset calculated rental price
          setIsErrandPrefilled(false);
        }
        // --- Conditional Redirection based on Resource Type ---
        setTimeout(() => {
          // Check if it's a new resource creation AND specifically a 'service-request' type
          if (!resourceId && type === 'service-request') {
            console.log("Redirecting to orderConfirmation for service-request...");
            Taro.navigateTo({ url: '/pages/orders/orderConfirmation' });
          } else {
            // For other types or for resource updates, navigate to the general orders index page
            console.log("Redirecting to general orders index...");
            Taro.switchTab({ url: '/pages/orders/index' });
          }
        }, 1500); // Delay the redirection slightly for the toast to show
      } else {
        const errorMessage = responseData.message || `错误：状态码 ${response.statusCode}`;
        setError(errorMessage);
        Taro.showToast({ title: errorMessage, icon: 'none' });
        console.error('API request failed:', response.statusCode, responseData);

        if (response.statusCode === 401 || response.statusCode === 403) {
          handleAuthError();
        }
      }

    } catch (error) {
      console.error("网络或提交过程中发生意外错误:", error);
      setError('提交过程中发生错误。');
      Taro.showToast({ title: '提交失败', icon: 'none' });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Determine submit button text based on whether we are editing or creating
  const submitButtonText = resourceId ?
    (isSubmitting ? '更新中...' : '更新请求') :
    (isSubmitting ? '提交中...' : '创建请求');

  // Modified handler for unit details change
  const handleUnitDetailsChange = (addressType, e) => {
    const unitDetails = e.detail.value;
    // Only allow unit details for errand addresses
    if (isCurrentTypeErrand) {
      if (addressType === 'from') {
        setFromAddress(prev => ({ ...prev, unitDetails: unitDetails }));
      } else if (addressType === 'to') {
        setToAddress(prev => ({ ...prev, unitDetails: unitDetails }));
      }
    }
  };

  // Effect to set default unit details
  useEffect(() => {
    if (!fromAddress.unitDetails && fromDoorDelivery) {
      setFromAddress(prev => ({ ...prev, unitDetails: '常规取货点' }));
    }
    if (!toAddress.unitDetails && toDoorDelivery) {
      setToAddress(prev => ({ ...prev, unitDetails: '常规放货点' }));
    }
  }, [fromDoorDelivery, toDoorDelivery]);

  // Effect to set current time as default when switching to starting mode
  useEffect(() => {
    if (timeMode === 'starting' && !startTime) {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      setStartDate(today);
      setStartTime(currentTime);
    }
  }, [timeMode]);

  // Add this effect after the other useEffect hooks
  useEffect(() => {
    // Set default starting date when type changes to lease or rent
    if (['lease', 'rent'].includes(type) && !fromTime) {
      setFromTime(getCurrentDate());
      
      // If using period mode, set a default period
      if (durationInputMode === 'period' && !periodQuantity) {
        setPeriodQuantity('1');
        setPeriodUnit('天');
      }
    }
  }, [type]); // Only run when type changes

  // Effect to set default unit details from saved address
  useEffect(() => {
    if (defaultAddress) {
      if (fromDoorDelivery && !fromDoorUnits) {
        setFromDoorUnits(defaultAddress.unitDetails || '');
      }
      if (toDoorDelivery && !toDoorUnits) {
        setToDoorUnits(defaultAddress.unitDetails || '');
      }
    }
  }, [fromDoorDelivery, toDoorDelivery, defaultAddress]);

  // Update price calculation for errand case
  useEffect(() => {
    const isErrandType = type === 'service-request' || type === 'service-offer';
    if (isErrandType) {
      let calculatedPrice = 0;

      // Ensure 'from' and 'to' addresses have district information before calculating
      if (fromAddress.district && toAddress.district) {
        // Calculate base minimum price
        calculatedPrice = fromAddress.district === toAddress.district ? 1 : 2;

        // Surcharge is ALWAYS based on the CURRENT CLIENT TIME for display
        const currentTimeForSurcharge = currentTime;
        if (isOutsidePeakPeriod(currentTimeForSurcharge)) {
          calculatedPrice *= 2;
        }

        // Add 3 for each door delivery
        if (fromDoorDelivery) {
          calculatedPrice += 3;
        }
        if (toDoorDelivery) {
          calculatedPrice += 3;
        }
      }

      if (parseFloat(price) !== calculatedPrice) {
        setPrice(calculatedPrice.toString());
        console.log('Calculated and setting price:', calculatedPrice);
      }
    }
  }, [type, fromAddress, toAddress, fromDoorDelivery, toDoorDelivery, currentTime]);

  return (
    <View className="request-page">
      <View className="page-header">
        <Text className="page-title">{resourceId ? '编辑请求' : '创建请求'}</Text>
        <Picker
          mode="selector"
          range={savedPresets.map(p => p.name)}
          onChange={(e) => applyPreset(e.detail.value)}
          disabled={isSubmitting || savedPresets.length === 0}
        >
          <Button 
            className="apply-preset-button" 
            disabled={isSubmitting || savedPresets.length === 0}
          >
            {savedPresets.length > 0 ? `应用预设 (${savedPresets.length})` : '无可用预设'}
          </Button>
        </Picker>
      </View>

      {/* Replace Type Picker with Dropdown */}
      <View 
        className="type-dropdown-container"
        onTouchStart={(e) => {
          e.stopPropagation();
        }}
      >
        <View 
          className="type-dropdown-trigger"
          onClick={(e) => {
            e.stopPropagation();
            setShowTypeDropdown(!showTypeDropdown);
          }}
        >
          <Text>{getTypeLabel(type)}</Text>
          <View className={`dropdown-arrow ${showTypeDropdown ? 'active' : ''}`} />
        </View>
        {showTypeDropdown && (
          <View 
            className="type-dropdown-menu"
            catchMove
          >
            {types.map((typeOption) => (
              <View
                key={typeOption.value}
                className={`type-dropdown-item ${type === typeOption.value ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleTypeSelect(typeOption);
                }}
              >
                <Text>{typeOption.label}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Add a transparent overlay when dropdown is open */}
      {showTypeDropdown && (
        <View
          className="dropdown-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 998
          }}
          onClick={() => setShowTypeDropdown(false)}
        />
      )}

      {/* Basic Input Fields - removed labels since we have placeholders */}
      <Input
        className="input-field"
        placeholder="名称"
        value={name}
        onInput={(e) => setName(e.detail.value)}
        disabled={isSubmitting}
      />

      {isCurrentTypeLeaseOrRent && (
        <View className="lease-rent-section">
          <View className='input-group price-input'>
            <Input
              className='input-field'
              type='digit'
              value={rentalRate}
              onInput={e => setRentalRate(e.detail.value)}
              placeholder='单位租赁价格'
            />
            <View 
              className='unit-selector'
              onTouchStart={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
                setShowRentalUnitDropdown(!showRentalUnitDropdown);
              }}
            >
              <Text>{rentalUnit}</Text>
              <View className='dropdown-arrow'>▼</View>
            </View>
            {showRentalUnitDropdown && (
              <View 
                className='unit-dropdown'
                catchMove
              >
                {['每天', '每周', '每月'].map(unit => (
                  <View
                    key={unit}
                    className='unit-option'
                    onClick={(e) => {
                      e.stopPropagation();
                      setRentalUnit(unit);
                      setShowRentalUnitDropdown(false);
                    }}
                  >
                    <Text>{unit}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          {/* Add overlay for rental unit dropdown */}
          {showRentalUnitDropdown && (
            <View
              className="dropdown-overlay"
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 998
              }}
              onClick={() => setShowRentalUnitDropdown(false)}
            />
          )}
          <View className='duration-input-section'>
            <View className='duration-mode-toggle'>
              <Switch
                checked={durationInputMode === 'period'}
                onChange={e => setDurationInputMode(e.detail.value ? 'period' : 'toDate')}
                color="#4CAF50"
              />
              <Text className="toggle-label">{durationInputMode === 'period' ? '结束日期' : '时长'}</Text>
            </View>
            {durationInputMode === 'toDate' ? (
              <View className='date-range-inputs'>
                <View className='date-input-row'>
                  <View className='date-input' style={{position:'relative'}}>
                    <Input
                      className='input-field'
                      value={fromTime}
                      placeholder={fromTimePlaceholder}
                      onFocus={() => setFromTimePlaceholder('YYYY-MM-DD')}
                      onBlur={e => {
                        setFromTimePlaceholder('开始日期');
                        if (e.detail.value === '') {
                          setFromTime('');
                        } else {
                          const formattedDate = parseDateInput(e.detail.value);
                          setFromTime(formattedDate);
                        }
                      }}
                      onInput={e => setFromTime(e.detail.value)}
                      disabled={isSubmitting}
                      style={{width: '100%', paddingRight: '32px'}}
                    />
                    <View style={{position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', zIndex:2, pointerEvents:'auto'}}>
                      <Picker
                        mode='date'
                        value={fromTime}
                        start={getCurrentDate()}
                        onChange={e => setFromTime(e.detail.value)}
                        disabled={isSubmitting}
                      >
                        <View 
                          className='date-picker-icon' 
                          style={{cursor: 'pointer'}}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >📅</View>
                      </Picker>
                    </View>
                  </View>
                  <View className='date-input' style={{position:'relative'}}>
                    <Input
                      className='input-field'
                      value={toTime}
                      placeholder={toTimePlaceholder}
                      onFocus={() => setToTimePlaceholder('YYYY-MM-DD')}
                      onBlur={e => {
                        setToTimePlaceholder('结束日期');
                        if (e.detail.value === '') {
                          setToTime('');
                        } else {
                          const formattedDate = parseDateInput(e.detail.value);
                          setToTime(formattedDate);
                        }
                      }}
                      onInput={e => setToTime(e.detail.value)}
                      disabled={isSubmitting}
                      style={{width: '100%', paddingRight: '32px'}}
                    />
                    <View style={{position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', zIndex:2, pointerEvents:'auto'}}>
                      <Picker
                        mode='date'
                        value={toTime}
                        start={fromTime || getCurrentDate()}
                        onChange={e => setToTime(e.detail.value)}
                        disabled={isSubmitting}
                      >
                        <View 
                          className='date-picker-icon' 
                          style={{cursor: 'pointer'}}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >📅</View>
                      </Picker>
                    </View>
                  </View>
                </View>
              </View>
            ) : (
              <View className='period-inputs'>
                <View className='date-input-row'>
                  <View className='date-input' style={{position:'relative'}}>
                    <Input
                      className='input-field'
                      value={fromTime}
                      placeholder='开始日期 (YYYY-MM-DD)'
                      onInput={e => setFromTime(e.detail.value)}
                      onBlur={e => {
                        if (e.detail.value === '') {
                          setFromTime('');
                        } else {
                          const formattedDate = formatDate(e.detail.value);
                          setFromTime(formattedDate);
                        }
                      }}
                      disabled={isSubmitting}
                      style={{width: '100%', paddingRight: '32px'}}
                    />
                    <View style={{position:'absolute', right:'8px', top:'50%', transform:'translateY(-50%)', zIndex:2, pointerEvents:'auto'}}>
                      <Picker
                        mode='date'
                        value={fromTime}
                        start={getCurrentDate()}
                        onChange={e => setFromTime(e.detail.value)}
                        disabled={isSubmitting}
                      >
                        <View 
                          className='date-picker-icon' 
                          style={{cursor: 'pointer'}}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >📅</View>
                      </Picker>
                    </View>
                  </View>
                  <View className='period-input'>
                    <Input
                      className='input-field'
                      type='text'
                      value={periodQuantity}
                      onInput={e => {
                        const value = e.detail.value;
                        const numericValue = stripUnitSuffix(value);
                        if (numericValue === '' || /^\d+$/.test(numericValue)) {
                          setPeriodQuantity(numericValue);
                        }
                      }}
                      onBlur={() => {
                        if (periodQuantity && periodQuantity !== '') {
                          const numericValue = stripUnitSuffix(periodQuantity);
                          setPeriodQuantity(numericValue + getUnitSuffix(rentalUnit));
                        }
                      }}
                      onFocus={() => {
                        setPeriodQuantity(stripUnitSuffix(periodQuantity));
                      }}
                      placeholder='时长'
                    />
                  </View>
                </View>
              </View>
            )}
          </View>
          {/* Display total price for lease/rent case */}
          {calculatedTotalRentalPrice > 0 && (
            <View className='total-price-display'>
              <Text className='total-price-label'>总价格: </Text>
              <Text className='total-price-value'>¥{calculatedTotalRentalPrice.toFixed(2)}</Text>
            </View>
          )}
        </View>
      )}

      {/* Non-Errand Address Section */}
      {!isCurrentTypeErrand && (
        <View className="resource-address-section">
          {renderAddressSearch('resource', resourceDeliveryAddress)}
        </View>
      )}

      {/* Errand Address Section */}
      {isCurrentTypeErrand && (
        <View className="errand-address-section">
          {/* From Address */}
          {renderAddressSearch('from', fromAddress)}
          
          {/* From Door Delivery */}
          <View className="door-delivery-section">
            <View className="door-delivery-row">
              <View className="switch-group">
                <Switch
                  checked={fromDoorDelivery}
                  onChange={(e) => {
                    setFromDoorDelivery(e.detail.value);
                    if (!e.detail.value) {
                      setFromDoorTime('');
                      setFromDoorUnits('');
                    }
                  }}
                  color="#4CAF50"
                />
                <Text className="switch-label">上门取货</Text>
              </View>
            </View>
            {fromDoorDelivery && (
              <View className="door-details-row">
                <Input
                  className="unit-details"
                  value={fromDoorUnits}
                  placeholder="具体单元/房间号"
                  onInput={(e) => setFromDoorUnits(e.detail.value)}
                  disabled={isSubmitting}
                />
                <View className="time-selector-container">
                  <View 
                    className="time-selector"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const dropdownKey = 'from-time';
                      setActiveTimeDropdown(activeTimeDropdown === dropdownKey ? null : dropdownKey);
                    }}
                  >
                    <Text className="selected-time">
                      {fromDoorTime || '选择时间'}
                    </Text>
                    <View className={`dropdown-arrow ${activeTimeDropdown === 'from-time' ? 'active' : ''}`} />
                  </View>
                  {activeTimeDropdown === 'from-time' && (
                    <View 
                      className="time-dropdown"
                      catchMove
                    >
                      {timeSlots.map((slot, index) => (
                        <View
                          key={index}
                          className={`time-option ${
                            fromDoorTime === slot ? 'selected' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFromDoorTime(slot);
                            setActiveTimeDropdown(null);
                          }}
                        >
                          <Text>{slot}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Add overlay for from-time dropdown */}
                {activeTimeDropdown === 'from-time' && (
                  <View
                    className="dropdown-overlay"
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 998
                    }}
                    onClick={() => setActiveTimeDropdown(null)}
                  />
                )}
              </View>
            )}
          </View>

          {/* To Address */}
          {renderAddressSearch('to', toAddress)}
          
          {/* To Door Delivery */}
          <View className="door-delivery-section">
            <View className="door-delivery-row">
              <View className="switch-group">
                <Switch
                  checked={toDoorDelivery}
                  onChange={(e) => {
                    setToDoorDelivery(e.detail.value);
                    if (!e.detail.value) {
                      setToDoorTime('');
                      setToDoorUnits('');
                    }
                  }}
                  color="#4CAF50"
                />
                <Text className="switch-label">送货上门</Text>
              </View>
            </View>
            {toDoorDelivery && (
              <View className="door-details-row">
                <Input
                  className="unit-details"
                  value={toDoorUnits}
                  placeholder="具体单元/房间号"
                  onInput={(e) => setToDoorUnits(e.detail.value)}
                  disabled={isSubmitting}
                />
                <View className="time-selector-container">
                  <View 
                    className="time-selector"
                    onTouchStart={(e) => {
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const dropdownKey = 'to-time';
                      setActiveTimeDropdown(activeTimeDropdown === dropdownKey ? null : dropdownKey);
                    }}
                  >
                    <Text className="selected-time">
                      {toDoorTime || '选择时间'}
                    </Text>
                    <View className={`dropdown-arrow ${activeTimeDropdown === 'to-time' ? 'active' : ''}`} />
                  </View>
                  {activeTimeDropdown === 'to-time' && (
                    <View 
                      className="time-dropdown"
                      catchMove
                    >
                      {timeSlots.map((slot, index) => (
                        <View
                          key={index}
                          className={`time-option ${
                            toDoorTime === slot ? 'selected' : ''
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setToDoorTime(slot);
                            setActiveTimeDropdown(null);
                          }}
                        >
                          <Text>{slot}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Add overlay for to-time dropdown */}
                {activeTimeDropdown === 'to-time' && (
                  <View
                    className="dropdown-overlay"
                    style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 998
                    }}
                    onClick={() => setActiveTimeDropdown(null)}
                  />
                )}
              </View>
            )}
          </View>

          {/* Display calculated price */}
          <View className="price-display">
            <Text className="price-label">价格: </Text>
            <Text className="price-value">¥{price}</Text>
          </View>
        </View>
      )}

      {/* Tips and Total Price Section */}
      {!isCurrentTypeLeaseOrRent && (
        <View className="tips-total-group">
          <Input
            className="tips-input"
            placeholder={isCurrentTypeErrand ? "小费" : "价格"}
            value={isCurrentTypeErrand ? tips : price}
            type="digit"
            onInput={(e) => isCurrentTypeErrand ? setTips(e.detail.value) : setPrice(e.detail.value)}
            readOnly={type === 'service-request' || type === 'service-offer'}
            disabled={isSubmitting}
          />
          {/* Display total price for errand case */}
          {isCurrentTypeErrand && (
            <View className='total-price-display'>
              <Text className='total-price-label'>总价格: </Text>
              <Text className='total-price-value'>¥{(parseFloat(price || 0) + parseFloat(tips || 0)).toFixed(2)}</Text>
            </View>
          )}
        </View>
      )}

      <Textarea
        className="textarea-field"
        placeholder="描述"
        value={description}
        onInput={(e) => setDescription(e.detail.value)}
        disabled={isSubmitting}
      />

      {/* --- Media Upload Section --- */}
      <Button onClick={handleMediaUpload}>上传图片/视频</Button>

      {/* Media preview section */}
      {media.length > 0 && (
        <View className="selected-media-previews">
          <Text className="section-title">已选择的媒体文件 ({media.length})</Text>
          <View className="previews-container">
            {media.map((file, index) => (
              <View key={file.tempFilePath || index} className="media-preview-item">
                {file.fileType === 'image' ? (
                  <Image src={file.tempFilePath} className="media-thumbnail" mode="aspectFill" />
                ) : (
                  <View className="media-thumbnail video-placeholder">视频</View>
                )}
                <View className="remove-media-button" onClick={() => handleRemoveMedia(index)}>
                  <Text className="remove-icon">x</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Preset Actions Section */}
      <View className="form-item preset-actions">
        <View className="action-buttons">
          <Button
            className="action-button"
            onClick={saveCurrentFormAsPreset}
            disabled={isSubmitting}
          >
            保存为预设
          </Button>
          <Picker
            mode="selector"
            range={savedPresets.map(p => p.name)}
            onChange={(e) => applyPreset(e.detail.value)}
            disabled={isSubmitting || savedPresets.length === 0}
          >
            <Button 
              className="action-button" 
              disabled={isSubmitting || savedPresets.length === 0}
            >
              {savedPresets.length > 0 ? `应用预设 (${savedPresets.length})` : '无可用预设'}
            </Button>
          </Picker>
        </View>
      </View>

      {/* Error Message */}
      {error && <Text className="error-message">{error}</Text>}

      {/* Save Preset Button */}
      <Button
        className="save-preset-button"
        onClick={saveCurrentFormAsPreset}
        disabled={isSubmitting}
      >
        保存为预设
      </Button>

      {/* Submit Button */}
      <Button
        className="submit-button"
        onClick={handleSubmit}
        loading={isSubmitting}
        disabled={isSubmitting ||
          (isCurrentTypeErrand && (!fromAddress.district || !fromAddress.building || !toAddress.district || !toAddress.building ||
            (timeMode === 'starting' && !startTime) ||
            (timeMode === 'arrival' && !arrivalTime))) ||
          (isCurrentTypeLeaseOrRent && (!fromTime || (durationInputMode === 'toDate' && !toTime) || (durationInputMode === 'period' && (!periodQuantity || !periodUnit)))) ||
          !name || !description || isNaN(parseFloat(price)) || parseFloat(price) <= 0}
      >
        {submitButtonText}
      </Button>
    </View>
  );
}

definePageConfig({
  navigationBarTitleText: "发布",
});
