/**
 * Subscription Upgrade Component
 * Handles subscription upgrades and payment processing
 */

'use client';

import React, { useState } from 'react';
import { SUBSCRIPTION_PLANS, PRICING } from '@/lib/subscription-plans.js';

export default function SubscriptionUpgrade({ userId, userEmail, userName, currentPlan, onClose, onSuccess }) {
  const [selectedPlan, setSelectedPlan] = useState('pro');
  const [billingInterval, setBillingInterval] = useState('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const proPlan = SUBSCRIPTION_PLANS.PRO;
  const monthlyPrice = PRICING.PRO_MONTHLY;
  const yearlyPrice = PRICING.PRO_YEARLY;

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!userEmail) {
        setError('User email is required. Please contact support.');
        setLoading(false);
        return;
      }

      // Create Stripe checkout session
      const checkoutResponse = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          email: userEmail,
          billingInterval: billingInterval
        })
      });

      const checkoutData = await checkoutResponse.json();

      if (checkoutData.success && checkoutData.url) {
        // Redirect to Stripe Checkout
        window.location.href = checkoutData.url;
      } else {
        setError(checkoutData.error || 'Failed to create checkout session');
        setLoading(false);
      }
    } catch (err) {
      setError('Failed to process upgrade. Please try again.');
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (onClose) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Upgrade to Pro</h2>
            <button
              onClick={handleCancel}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-gray-600 text-sm mt-2">
            {proPlan.description || 'Best for active researchers and professionals who need the full stack.'}
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="p-6 border-b">
          <div className="flex items-center justify-center space-x-4">
            <span className={`text-sm ${billingInterval === 'monthly' ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              Monthly
            </span>
            <button
              onClick={() => setBillingInterval(billingInterval === 'monthly' ? 'yearly' : 'monthly')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                billingInterval === 'yearly' ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  billingInterval === 'yearly' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm ${billingInterval === 'yearly' ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              Yearly
            </span>
            {billingInterval === 'yearly' && (
              <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">
                Save $48/year
              </span>
            )}
          </div>
        </div>

        {/* Pricing - matches genlatex-website Pricing section */}
        <div className="p-6 border-b">
          <div className="text-center">
            {billingInterval === 'yearly' ? (
              <>
                <div className="text-4xl font-bold text-gray-900">
                  ${yearlyPrice}
                </div>
                <div className="text-gray-600 text-sm">
                  /month (billed yearly)
                </div>
                <div className="text-sm text-green-600 mt-1">
                  Save ${(monthlyPrice - yearlyPrice) * 12}/year
                </div>
              </>
            ) : (
              <>
                <div className="text-4xl font-bold text-gray-900">
                  ${monthlyPrice}
                </div>
                <div className="text-gray-600 text-sm">
                  /month
                </div>
              </>
            )}
          </div>
        </div>

        {/* Features */}
        <div className="p-6 border-b">
          <h3 className="font-semibold text-gray-900 mb-3">Pro Features</h3>
          <ul className="space-y-2">
            {proPlan.features.map((feature, index) => (
              <li key={index} className="flex items-center text-sm text-gray-600">
                <svg className="w-4 h-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {feature}
              </li>
            ))}
          </ul>
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-6 border-b">
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="p-6">
          <div className="flex space-x-3">
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleUpgrade}
              disabled={loading}
              className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Processing...' : 'Start Writing'}
            </button>
          </div>
          
          <p className="text-xs text-gray-500 text-center mt-3">
            Secure payment processing. Cancel anytime.
          </p>
        </div>
      </div>
    </div>
  );
}
