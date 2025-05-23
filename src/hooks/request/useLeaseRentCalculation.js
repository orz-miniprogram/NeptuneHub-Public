import { useState, useEffect } from 'react';
import { differenceInDays, parseISO, addDays, addWeeks, addMonths, isValid } from 'date-fns';

const useLeaseRentCalculation = () => {
  const [durationInputMode, setDurationInputMode] = useState('toDate');
  const [periodQuantity, setPeriodQuantity] = useState('');
  const [periodUnit, setPeriodUnit] = useState('天');
  const [fromTime, setFromTime] = useState('');
  const [toTime, setToTime] = useState('');
  const [rentalRate, setRentalRate] = useState('');
  const [rentalUnit, setRentalUnit] = useState('每天');
  const [calculatedTotalRentalPrice, setCalculatedTotalRentalPrice] = useState(0);

  const getDaysFromPeriod = (quantity, unit, fromDateStr) => {
    const fromDate = parseISO(fromDateStr);
    if (!quantity || !unit || !isValid(fromDate)) return 0;

    const numQuantity = parseInt(quantity, 10);
    if (isNaN(numQuantity) || numQuantity <= 0) return 0;

    let calculatedEndDate;
    switch (unit) {
      case '天':
        calculatedEndDate = addDays(fromDate, numQuantity);
        break;
      case '周':
        calculatedEndDate = addWeeks(fromDate, numQuantity);
        break;
      case '月':
        calculatedEndDate = addMonths(fromDate, numQuantity);
        break;
      default:
        return 0;
    }

    return differenceInDays(calculatedEndDate, fromDate);
  };

  const resetLeaseState = () => {
    setDurationInputMode('toDate');
    setPeriodQuantity('');
    setPeriodUnit('天');
    setFromTime('');
    setToTime('');
    setRentalRate('');
    setRentalUnit('每天');
    setCalculatedTotalRentalPrice(0);
  };

  useEffect(() => {
    let currentCalculatedRentalPrice = 0;
    const rate = parseFloat(rentalRate);

    if (!isNaN(rate) && rate > 0 && fromTime) {
      const startDate = parseISO(fromTime);

      if (!isValid(startDate)) {
        console.warn("Invalid start date for rental calculation.");
        setCalculatedTotalRentalPrice(0);
        return;
      }

      let totalDays = 0;

      if (durationInputMode === 'toDate' && toTime) {
        const endDate = parseISO(toTime);
        if (!isValid(endDate) || endDate < startDate) {
          console.warn("Invalid end date or end date is before start date.");
          setCalculatedTotalRentalPrice(0);
          return;
        }
        totalDays = differenceInDays(endDate, startDate);
      } else if (durationInputMode === 'period' && periodQuantity && periodUnit) {
        totalDays = getDaysFromPeriod(periodQuantity, periodUnit, fromTime);
        if (totalDays <= 0) {
          console.warn("Calculated total days from period is not positive.");
          setCalculatedTotalRentalPrice(0);
          return;
        }
      } else {
        setCalculatedTotalRentalPrice(0);
        return;
      }

      if (totalDays > 0) {
        switch (rentalUnit) {
          case '每天':
            currentCalculatedRentalPrice = rate * totalDays;
            break;
          case '每周':
            currentCalculatedRentalPrice = rate * (totalDays / 7);
            break;
          case '每月':
            currentCalculatedRentalPrice = rate * (totalDays / 30.44);
            break;
        }
      }

      currentCalculatedRentalPrice = parseFloat(currentCalculatedRentalPrice.toFixed(2));
    }

    if (currentCalculatedRentalPrice !== calculatedTotalRentalPrice) {
      setCalculatedTotalRentalPrice(currentCalculatedRentalPrice);
    }
  }, [rentalRate, rentalUnit, fromTime, toTime, durationInputMode, periodQuantity, periodUnit]);

  return {
    durationState: {
      durationInputMode,
      periodQuantity,
      periodUnit,
      fromTime,
      toTime
    },
    rentalState: {
      rentalRate,
      rentalUnit,
      calculatedTotalRentalPrice
    },
    actions: {
      setDurationInputMode,
      setPeriodQuantity,
      setPeriodUnit,
      setFromTime,
      setToTime,
      setRentalRate,
      setRentalUnit,
      resetLeaseState
    }
  };
};

export default useLeaseRentCalculation; 