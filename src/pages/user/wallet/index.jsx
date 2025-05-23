// frontend/src/pages/user/wallet/index.jsx

import React, { useState, useEffect, useCallback } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, Button, Form } from '@tarojs/components';
import './index.scss'; // Import the styling for this page

// Define page configuration for Taro (e.g., navigation bar title)
definePageConfig({
  navigationBarTitleText: '我的钱包', // Translate: My Wallet
});

export default function WalletPage() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [isProcessingWithdrawal, setIsProcessingWithdrawal] = useState(false);

  // Function to fetch wallet data from the backend
  const fetchWalletData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const authToken = Taro.getStorageSync('authToken');

    if (!authToken) {
      Taro.showToast({ title: '请登录', icon: 'none' });
      // Give some time for toast to be seen before redirecting
      setTimeout(() => Taro.redirectTo({ url: '/pages/user/login/index' }), 1500);
      setLoading(false);
      return;
    }

    try {
      const res = await Taro.request({
        url: API_BASE_URL + `/api/user/wallet`, // Your new backend endpoint
        method: 'GET',
        header: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (res.statusCode === 200) {
        setBalance(res.data.balance);
        setTransactions(res.data.transactions);
      } else if (res.statusCode === 401 || res.statusCode === 403) {
        Taro.removeStorageSync('authToken');
        Taro.removeStorageSync('userId');
        Taro.showToast({ title: '登录过期，请重新登录', icon: 'none' });
        setTimeout(() => Taro.redirectTo({ url: '/pages/user/login/index' }), 1500);
      } else {
        setError(res.data.message || '加载钱包数据失败。');
        Taro.showToast({ title: res.data.message || '加载钱包数据失败', icon: 'none' });
      }
    } catch (err) {
      console.error('Error fetching wallet data:', err);
      setError('网络错误，无法加载钱包数据。');
      Taro.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch data when the component mounts and when `WorkspaceWalletData` changes
  useEffect(() => {
    fetchWalletData();
  }, [fetchWalletData]);

  // Handler for withdrawal submission
  const handleWithdrawal = useCallback(async () => {
    const amount = parseFloat(withdrawalAmount);

    if (isNaN(amount) || amount <= 0) {
      Taro.showToast({ title: '请输入有效提现金额。', icon: 'none' });
      return;
    }

    if (amount > balance) {
      Taro.showToast({ title: '提现金额不能超过余额。', icon: 'none' });
      return;
    }

    // Optional: Add a minimum withdrawal amount check here if not handled by backend entirely
    // const MIN_WITHDRAWAL = 1.00;
    // if (amount < MIN_WITHDRAWAL) {
    //   Taro.showToast({ title: `最低提现金额为 ¥${MIN_WITHDRAWAL.toFixed(2)}。`, icon: 'none' });
    //   return;
    // }


    // Confirmation before withdrawal via Taro.showModal
    Taro.showModal({
      title: '确认提现',
      content: `您确定要提现 ¥${amount.toFixed(2)} 吗？提现将通过微信转账。`, // Assuming RMB currency
      confirmText: '确认提现',
      cancelText: '取消',
      success: async (res) => {
        if (res.confirm) {
          setIsProcessingWithdrawal(true);
          Taro.showLoading({ title: '提现中...' });
          const authToken = Taro.getStorageSync('authToken');

          try {
            const response = await Taro.request({
              url: API_BASE_URL + '/api/payment/payout', // Your existing payout API endpoint
              method: 'POST',
              header: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json',
              },
              data: {
                amount: amount, // Amount in RM (backend expects this)
                description: `用户提现 ¥${amount.toFixed(2)}`, // Description for the payout
              },
            });

            if (response.statusCode === 200) {
              Taro.showToast({ title: '提现请求成功，请等待到账。', icon: 'success' });
              setWithdrawalAmount(''); // Clear input field
              fetchWalletData(); // Refresh wallet data to reflect changes
            } else {
              Taro.showToast({ title: response.data.message || '提现失败，请重试。', icon: 'none' });
            }
          } catch (err) {
            console.error('Error during withdrawal request:', err);
            Taro.showToast({ title: '网络错误，提现失败。', icon: 'none' });
          } finally {
            setIsProcessingWithdrawal(false);
            Taro.hideLoading();
          }
        }
      }
    });
  }, [withdrawalAmount, balance, fetchWalletData]); // Depend on these states/functions

  // Conditional rendering for loading, error, and actual content
  if (loading) {
    return (
      <View className="wallet-page">
        <Text>加载中...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="wallet-page">
        <Text className="error-message">{error}</Text>
        <Button onClick={fetchWalletData}>点击重试</Button>
      </View>
    );
  }

  return (
    <View className="wallet-page">
      <View className="wallet-summary">
        <Text className="balance-label">当前余额</Text>
        <Text className="balance-amount">¥ {balance.toFixed(2)}</Text> {/* Display with 2 decimal places */}
      </View>

      {/* Withdrawal Section */}
      <View className="withdrawal-section">
        <Text className="section-title">提现</Text>
        <Input
          type="digit" // Allows only digits and one decimal point
          value={withdrawalAmount}
          onInput={(e) => {
            // Basic input validation to allow only numbers and up to 2 decimal places
            const value = e.detail.value;
            if (value.match(/^\d*\.?\d{0,2}$/)) {
              setWithdrawalAmount(value);
            }
          }}
          placeholder="输入提现金额"
          className="withdrawal-input"
        />
        <Button
          onClick={handleWithdrawal}
          disabled={isProcessingWithdrawal || parseFloat(withdrawalAmount) === 0 || !withdrawalAmount}
          className="withdrawal-button"
        >
          {isProcessingWithdrawal ? '处理中...' : '提现到微信'}
        </Button>
      </View>

      {/* Transaction History */}
      <View className="transaction-history">
        <Text className="section-title">交易记录</Text>
        {transactions.length > 0 ? (
          <View className="transaction-list">
            {transactions.map((tx) => (
              <View key={tx._id} className="transaction-item"> {/* Use tx._id for key if available */}
                <View className="transaction-details">
                  <Text className={`transaction-type ${tx.type === 'credit' ? 'credit' : 'debit'}`}>
                    {tx.type === 'credit' ? '收入' : '支出'}
                  </Text>
                  <Text className="transaction-description">{tx.description}</Text>
                  <Text className="transaction-date">
                    {new Date(tx.createdAt).toLocaleString()}
                  </Text>
                </View>
                <View className="transaction-amount">
                  <Text className={`amount-value ${tx.type === 'credit' ? 'credit' : 'debit'}`}>
                    {tx.type === 'credit' ? '+' : '-'}¥{tx.amount.toFixed(2)}
                  </Text>
                  {/* Display status only if not 'completed' (default) */}
                  {tx.status !== 'completed' && (
                    <Text className={`transaction-status status-${tx.status}`}>{tx.status}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text className="no-transactions">暂无交易记录。</Text> // Translate: No transaction records yet.
        )}
      </View>
    </View>
  );
}
