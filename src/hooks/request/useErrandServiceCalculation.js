import { useState, useEffect } from 'react';
import { isOutsidePeakPeriod } from '../../utils/isOutsidePeakPeriod';

const useErrandServiceCalculation = () => {
  const [timeMode, setTimeMode] = useState('off');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [arrivalTime, setArrivalTime] = useState('');
  const [fromDoorDelivery, setFromDoorDelivery] = useState(false);
  const [toDoorDelivery, setToDoorDelivery] = useState(false);
  const [fromDoorUnits, setFromDoorUnits] = useState('');
  const [toDoorUnits, setToDoorUnits] = useState('');
  const [fromDoorTime, setFromDoorTime] = useState('');
  const [toDoorTime, setToDoorTime] = useState('');
  const [tips, setTips] = useState('');
  const [basePrice, setBasePrice] = useState('1');
  const [currentTime, setCurrentTime] = useState('00:00');

  const getCurrentHHMM = () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Initialize and update current time
  useEffect(() => {
    setCurrentTime(getCurrentHHMM());
    const intervalId = setInterval(() => {
      setCurrentTime(getCurrentHHMM());
    }, 60000); // Update every minute

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, []);

  const calculatePrice = (fromAddress, toAddress, currentTime) => {
    let calculatedPrice = 0;

    if (fromAddress?.district && toAddress?.district) {
      // Calculate base minimum price
      calculatedPrice = fromAddress.district === toAddress.district ? 1 : 2;

      // Apply surcharge based on current time
      if (isOutsidePeakPeriod(currentTime)) {
        calculatedPrice *= 2;
      }

      // Add door delivery charges
      if (fromDoorDelivery) {
        calculatedPrice += 3;
      }
      if (toDoorDelivery) {
        calculatedPrice += 3;
      }
    }

    return calculatedPrice;
  };

  const resetErrandService = () => {
    setTimeMode('off');
    setStartDate('');
    setStartTime('');
    setArrivalDate('');
    setArrivalTime('');
    setFromDoorDelivery(false);
    setToDoorDelivery(false);
    setFromDoorUnits('');
    setToDoorUnits('');
    setFromDoorTime('');
    setToDoorTime('');
    setTips('');
    setBasePrice('1');
  };

  useEffect(() => {
    if (timeMode === 'starting' && !startTime) {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      setStartDate(today);
      setStartTime(getCurrentHHMM());
    }
  }, [timeMode]);

  return {
    timeState: {
      timeMode,
      startDate,
      startTime,
      arrivalDate,
      arrivalTime
    },
    doorDeliveryState: {
      fromDoorDelivery,
      toDoorDelivery,
      fromDoorUnits,
      toDoorUnits,
      fromDoorTime,
      toDoorTime
    },
    priceState: {
      tips,
      basePrice
    },
    actions: {
      setTimeMode,
      setStartDate,
      setStartTime,
      setArrivalDate,
      setArrivalTime,
      setFromDoorDelivery,
      setToDoorDelivery,
      setFromDoorUnits,
      setToDoorUnits,
      setFromDoorTime,
      setToDoorTime,
      setTips,
      setBasePrice,
      resetErrandService
    },
    utils: {
      calculatePrice,
      getCurrentHHMM
    }
  };
};

export default useErrandServiceCalculation; 