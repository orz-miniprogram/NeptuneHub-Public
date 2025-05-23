import React, { useState, useEffect, useRef } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Picker, Button, Image } from '@tarojs/components';
import rawFoodData from '../../data/food_data.csv?raw';
import './index.scss';
import backgroundImage from './background.jpg';

const Index = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [foodItems, setFoodItems] = useState([]);
  const [changeTitleInterval, setChangeTitleInterval] = useState(null);
  const [selectedFood, setSelectedFood] = useState(null);
  const [startCount, setStartCount] = useState(0);
  const [parsedFoodData, setParsedFoodData] = useState([]);
  const [campusOptions, setCampusOptions] = useState([{ value: 'all', label: '全部校区' }]);
  const [canteenOptions, setCanteenOptions] = useState([{ value: 'all', label: '全部食堂' }]);
  const [floorOptions, setFloorOptions] = useState([{ value: 'all', label: '全部楼层' }]);
  const [selectedCampus, setSelectedCampus] = useState('all');
  const [selectedCanteen, setSelectedCanteen] = useState('all');
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [foodTitle, setFoodTitle] = useState('今天吃啥');
  const [locationInfo, setLocationInfo] = useState('');
  const foodItemsContainerRef = useRef(null);

  const loadFoodData = async () => {
    try {
      const parsed = parseCSV(rawFoodData);
      console.log('Result of parseCSV in loadFoodData:', parsed); // Debugging log
      return parsed;
    } catch (error) {
      console.error('无法解析食品数据:', error);
      Taro.showToast({ title: '无法解析食品数据', icon: 'none' });
      return [];
    }
  };

  const parseCSV = (csvText) => {
    const lines = csvText.trim().split('\n');
    console.log('Number of CSV Lines:', lines.length); // Debugging log
    const headers = lines[0] ? lines[0].split(',') : [];
    console.log('CSV Headers:', headers);

    const parsedItems = lines.slice(1).map((line, rowIndex) => {
      const values = line.split(',');
      console.log(`Row ${rowIndex + 2} Values:`, values);
      const item = {};

      headers.forEach((header, index) => {
        item[header.trim()] = values[index] ? values[index].trim() : '';
      });
      console.log(`Row ${rowIndex + 2} Item:`, item);
      return item;
    });
    console.log('Parsed Items Array:', parsedItems); // Debugging log
    return parsedItems;
  };

  const filterFoodData = (data) => {
    return data.filter((item) => {
      return (
        (selectedCampus === 'all' || item.campus === selectedCampus) &&
        (selectedCanteen === 'all' || item.canteen === selectedCanteen) &&
        (selectedFloor === 'all' || item.floor === selectedFloor)
      );
    });
  };

  const initializeSelectors = (data) => {
    if (data && data.length > 0) {
      const campuses = [...new Set(data.map((item) => item.campus))];
      setCampusOptions([{ value: 'all', label: '全部校区' }, ...campuses.map(c => ({ value: c, label: c }))]);
      updateCanteenOptions(data, 'all');
      updateFloorOptions(data, 'all', 'all');
    }
  };

  const updateCanteenOptions = (data, campus) => {
    let canteens = [];
    if (data && data.length > 0) {
      if (campus === 'all') {
        canteens = [...new Set(data.map((item) => item.canteen))];
      } else {
        canteens = [
          ...new Set(
            data.filter((item) => item.campus === campus).map((item) => item.canteen)
          ),
        ];
      }
    }
    setCanteenOptions([{ value: 'all', label: '全部食堂' }, ...canteens.map(c => ({ value: c, label: c }))]);
    setSelectedCanteen('all');
    updateFloorOptions(data, campus, 'all');
  };

  const updateFloorOptions = (data, campus, canteen) => {
    let floors = [];
    if (data && data.length > 0) {
      if (campus === 'all' && canteen === 'all') {
        floors = [...new Set(data.map((item) => item.floor))];
      } else if (campus === 'all') {
        floors = [...new Set(data.filter((item) => item.canteen === canteen).map((item) => item.floor))];
      } else if (canteen === 'all') {
        floors = [...new Set(data.filter((item) => item.campus === campus).map((item) => item.floor))];
      } else {
        floors = [
          ...new Set(
            data.filter((item) => item.campus === campus && item.canteen === canteen).map((item) => item.floor)
          ),
        ];
      }
    }
    setFloorOptions([{ value: 'all', label: '全部楼层' }, ...floors.map(f => ({ value: f, label: f }))]);
    setSelectedFloor('all');
  };

  const createRandomFoodItem = (food) => {
    if (foodItemsContainerRef.current) {
      const foodElement = document.createElement('div');
      foodElement.className = 'food-item';
      foodElement.textContent = food;

      const containerWidth = Taro.getSystemInfoSync().windowWidth;
      const containerHeight = Taro.getSystemInfoSync().windowHeight;
      const x = Math.random() * (containerWidth - 100);
      const y = Math.random() * containerHeight;
      const size = Math.ceil(Math.random() * (37 - 14) + 14);
      const opacity = Math.random();

      foodElement.style.left = `${x}px`;
      foodElement.style.top = `${y}px`;
      foodElement.style.fontSize = `${size}px`;
      foodElement.style.color = `rgba(0,0,0,${opacity})`;

      foodItemsContainerRef.current.appendChild(foodElement);

      setTimeout(() => {
        if (foodElement && foodItemsContainerRef.current && foodItemsContainerRef.current.contains(foodElement)) {
          foodItemsContainerRef.current.removeChild(foodElement);
        }
      }, 2000);
    }
    return food;
  };

  const startSelection = (filteredFoodData) => {
    if (filteredFoodData.length === 0) {
      Taro.showToast({ title: '没有符合条件的食品数据', icon: 'none' });
      return;
    }

    setStartCount((prevCount) => prevCount + 1);
    if (startCount + 1 > 10) {
      setFoodTitle('这么挑？饿着吧！');
      return;
    }

    setIsRunning(true);
    setFoodTitle('...');
    Taro.setNavigationBarTitle({ title: '选择中...' });

    const intervalId = setInterval(() => {
      if (filteredFoodData.length > 0) {
        const randomIndex = Math.floor(Math.random() * filteredFoodData.length);
        const food = filteredFoodData[randomIndex];
        setFoodTitle(food.name);
        createRandomFoodItem(food.name);
        setSelectedFood(food);
      }
    }, 80);
    setChangeTitleInterval(intervalId);
  };

  const stopSelection = () => {
    setIsRunning(false);
    setFoodTitle(selectedFood?.name || '今天吃啥');
    Taro.setNavigationBarTitle({ title: '今天吃什么？' });
    if (changeTitleInterval) {
      clearInterval(changeTitleInterval);
      setChangeTitleInterval(null);
    }
    if (selectedFood) {
      setLocationInfo(`位置：${selectedFood.campus} - ${selectedFood.canteen} - ${selectedFood.floor}楼 ${selectedFood.window}`);
    }
  };

  const toggleSelection = async () => {
    if (!isRunning) {
      setLocationInfo('');
      const allFoodData = await loadFoodData();
      setParsedFoodData(allFoodData);
      const filteredFoodData = filterFoodData(allFoodData);

      if (filteredFoodData.length === 0) {
        Taro.showToast({ title: '没有符合条件的食品项', icon: 'none' });
        return;
      }
      startSelection(filteredFoodData);
    } else {
      stopSelection();
    }
  };

  useEffect(() => {
    loadFoodData().then((data) => {
      if (data && data.length > 0) {
        setParsedFoodData(data);
        console.log('Parsed Food Data in useEffect:', data); // Debugging log
        initializeSelectors(data);
      } else {
        Taro.showToast({ title: '无法加载食品数据或数据为空', icon: 'none' });
      }
    });
  }, []);

  const handleCampusChange = (e) => {
    const value = e.detail.value;
    setSelectedCampus(value);
    updateCanteenOptions(parsedFoodData, value);
  };

  const handleCanteenChange = (e) => {
    const value = e.detail.value;
    setSelectedCanteen(value);
    updateFloorOptions(parsedFoodData, selectedCampus, value);
  };

  const handleFloorChange = (e) => {
    setSelectedFloor(e.detail.value);
  };

  const buttonText = isRunning ? '停止' : '不行，换一个';

  return (
    <View className="container">
      <Image className="background-image" src={backgroundImage} mode="aspectFill" />
      <View className="selection-panel">
        <View className="selection-group">
          <Text>校区：</Text>
          <Picker mode="selector" range={campusOptions.map(opt => opt.label)} rangeKey="label" onChange={handleCampusChange}>
            <View className="selector">{campusOptions.find(opt => opt.value === selectedCampus)?.label || '全部校区'}</View>
          </Picker>
        </View>

        <View className="selection-group">
          <Text>食堂：</Text>
          <Picker mode="selector" range={canteenOptions.map(opt => opt.label)} rangeKey="label" onChange={handleCanteenChange}>
            <View className="selector">{canteenOptions.find(opt => opt.value === selectedCanteen)?.label || '全部食堂'}</View>
          </Picker>
        </View>

        <View className="selection-group">
          <Text>楼层：</Text>
          <Picker mode="selector" range={floorOptions.map(opt => opt.label)} rangeKey="label" onChange={handleFloorChange}>
            <View className="selector">{floorOptions.find(opt => opt.value === selectedFloor)?.label || '全部楼层'}</View>
          </Picker>
        </View>
      </View>

      <View className="main-content">
        <Text className="food-title">{foodTitle}</Text>
        <View className="food-info">
          <Text id="location-info">{locationInfo}</Text>
        </View>
        <Button className="toggle-btn" onClick={toggleSelection}>{buttonText}</Button>
      </View>

      <View className="food-items-container" ref={foodItemsContainerRef}>
        {/* 随机食品项将在此动态显示 */}
      </View>
    </View>
  );
};

export default Index;
