import { useState, useEffect } from 'react';
import { searchBuildings } from '../../utils/fuzzySearch';
import { buildings } from '../../data/buildings';

const useAddressManagement = (defaultAddress = null) => {
  const [fromAddress, setFromAddress] = useState({ district: null, building: '', unitDetails: '' });
  const [toAddress, setToAddress] = useState({ district: null, building: '', unitDetails: '' });
  const [resourceDeliveryAddress, setResourceDeliveryAddress] = useState({ 
    district: null, 
    building: '', 
    unitDetails: '' 
  });
  
  const [buildingSearchQuery, setBuildingSearchQuery] = useState('');
  const [buildingSearchResults, setBuildingSearchResults] = useState([]);
  const [showBuildingResults, setShowBuildingResults] = useState(false);
  const [showFromAddressDropdown, setShowFromAddressDropdown] = useState(false);
  const [showToAddressDropdown, setShowToAddressDropdown] = useState(false);
  const [addressInputMode, setAddressInputMode] = useState('select');

  // Effect to set default address
  useEffect(() => {
    if (defaultAddress && !resourceDeliveryAddress.building) {
      setResourceDeliveryAddress({
        district: defaultAddress.district,
        building: defaultAddress.building,
        unitDetails: defaultAddress.unitDetails || ''
      });
    }
  }, [defaultAddress]);

  const resetAddresses = () => {
    setFromAddress({ district: null, building: '', unitDetails: '' });
    setToAddress({ district: null, building: '', unitDetails: '' });
    setResourceDeliveryAddress({ district: null, building: '', unitDetails: '' });
    setBuildingSearchQuery('');
    setBuildingSearchResults([]);
    setShowBuildingResults(false);
    setShowFromAddressDropdown(false);
    setShowToAddressDropdown(false);
    setAddressInputMode('select');
  };

  const handleBuildingSearch = (addressType, query) => {
    setBuildingSearchQuery(query);
    const results = searchBuildings(query, buildings);
    setBuildingSearchResults(results);
    setShowBuildingResults(true);
    setShowFromAddressDropdown(false);
    setShowToAddressDropdown(false);
  };

  const handleDropdownToggle = (addressType, e) => {
    e.stopPropagation();
    
    if (addressInputMode === 'select') {
      if (addressType === 'from') {
        setShowFromAddressDropdown(!showFromAddressDropdown);
        setShowToAddressDropdown(false);
      } else if (addressType === 'to') {
        setShowToAddressDropdown(!showToAddressDropdown);
        setShowFromAddressDropdown(false);
      }
      setShowBuildingResults(false);
    } else {
      setShowBuildingResults(!showBuildingResults);
      setShowFromAddressDropdown(false);
      setShowToAddressDropdown(false);
    }
  };

  const handleBuildingSelect = (addressType, selectedBuilding) => {
    const newAddress = {
      district: selectedBuilding.district,
      building: selectedBuilding.buildingId
    };

    switch (addressType) {
      case 'from':
        setFromAddress(prev => ({ ...prev, ...newAddress }));
        break;
      case 'to':
        setToAddress(prev => ({ ...prev, ...newAddress }));
        break;
      case 'resource':
        setResourceDeliveryAddress(prev => ({ ...prev, ...newAddress }));
        break;
    }

    setBuildingSearchQuery('');
    setBuildingSearchResults([]);
    setShowBuildingResults(false);
  };

  const handleSavedAddressSelect = (addressType, savedAddress) => {
    const addressToSet = {
      district: savedAddress.district,
      building: savedAddress.building,
      unitDetails: savedAddress.unitDetails || ''
    };
    
    switch (addressType) {
      case 'from':
        setFromAddress(addressToSet);
        break;
      case 'to':
        setToAddress(addressToSet);
        break;
      case 'resource':
        setResourceDeliveryAddress(addressToSet);
        break;
    }

    setShowFromAddressDropdown(false);
    setShowToAddressDropdown(false);
    setBuildingSearchQuery('');
  };

  const handleUnitDetailsChange = (addressType, unitDetails) => {
    switch (addressType) {
      case 'from':
        setFromAddress(prev => ({ ...prev, unitDetails }));
        break;
      case 'to':
        setToAddress(prev => ({ ...prev, unitDetails }));
        break;
      case 'resource':
        setResourceDeliveryAddress(prev => ({ ...prev, unitDetails }));
        break;
    }
  };

  return {
    addresses: {
      fromAddress,
      toAddress,
      resourceDeliveryAddress
    },
    searchState: {
      buildingSearchQuery,
      buildingSearchResults,
      showBuildingResults,
      showFromAddressDropdown,
      showToAddressDropdown,
      addressInputMode
    },
    actions: {
      setFromAddress,
      setToAddress,
      setResourceDeliveryAddress,
      handleBuildingSearch,
      handleDropdownToggle,
      handleBuildingSelect,
      handleSavedAddressSelect,
      handleUnitDetailsChange,
      setAddressInputMode,
      resetAddresses
    }
  };
};

export default useAddressManagement; 