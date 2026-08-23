const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
require('dotenv').config();

// Supabase Setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Constants
const ORE_PER_TAP = 2;
const ENERGY_MAX = 1000;
const REFERRAL_REWARD_REFERRER = 500;
const REFERRAL_REWARD_REFERRED = 300;
const MIN_WITHDRAWAL = 20;
const WITHDRAWAL_THRESHOLD_LEVEL = 5;
const MIN_REFERRALS = 10;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Deep Vein Server is running' });
});

// Register or Update User
app.post('/api/user/register', async (req, res) => {
  try {
    const { telegramId, username } = req.body;

    const { data, error } = await supabase
      .from('users')
      .upsert({
        telegram_id: telegramId,
        username: username || `user_${telegramId}`,
        ore: 0,
        energy: ENERGY_MAX,
        level: 1,
        referral_count: 0,
        total_earned: 0,
        last_tap: new Date(),
      })
      .select();

    if (error) throw error;
    res.json({ success: true, user: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mining - Tap to earn ORE
app.post('/api/mining/tap', async (req, res) => {
  try {
    const { telegramId } = req.body;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError) throw userError;
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (user.energy <= 0) {
      return res.json({ success: false, message: 'Not enough energy' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({
        ore: user.ore + ORE_PER_TAP,
        energy: Math.max(0, user.energy - 1),
        last_tap: new Date(),
      })
      .eq('telegram_id', telegramId)
      .select();

    if (updateError) throw updateError;
    res.json({ success: true, user: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('*');

    if (error) throw error;
    res.json({ success: true, tasks: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Complete Task
app.post('/api/task/complete', async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError) throw userError;

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single();

    if (taskError) throw taskError;

    await supabase
      .from('users')
      .update({ ore: user.ore + (task.reward || 100) })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `Task completed! +${task.reward || 100} ORE` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Referral Link
app.get('/api/referral/link/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const referralLink = `https://t.me/nabdbooks_bot?start=${telegramId}`;
    res.json({ success: true, referralLink });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create Referral
app.post('/api/referral/invite', async (req, res) => {
  try {
    const { referrerTelegramId, referredTelegramId } = req.body;

    const { data: referrer } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', referrerTelegramId)
      .single();

    const { data: referred } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', referredTelegramId)
      .single();

    await supabase
      .from('users')
      .update({
        ore: referrer.ore + REFERRAL_REWARD_REFERRER,
        referral_count: referrer.referral_count + 1,
      })
      .eq('telegram_id', referrerTelegramId);

    await supabase
      .from('users')
      .update({ ore: referred.ore + REFERRAL_REWARD_REFERRED })
      .eq('telegram_id', referredTelegramId);

    res.json({ success: true, message: 'Referral bonus awarded!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Buy Upgrade
app.post('/api/store/upgrade', async (req, res) => {
  try {
    const { telegramId, upgradeId } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    const upgradeCosts = { energy_boost: 100, ore_multiplier: 500 };
    const cost = upgradeCosts[upgradeId] || 0;

    if (user.ore < cost) {
      return res.json({ success: false, message: 'Not enough ORE' });
    }

    await supabase
      .from('users')
      .update({ ore: user.ore - cost })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `Upgrade purchased! -${cost} ORE` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Request Withdrawal
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { telegramId, amount } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (amount < MIN_WITHDRAWAL) {
      return res.json({ success: false, message: `Minimum withdrawal: $${MIN_WITHDRAWAL}` });
    }

    res.json({ success: true, message: 'Withdrawal request created!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('username, ore, level')
      .order('ore', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, leaderboard: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get User Stats
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (error) throw error;
    res.json({ success: true, user: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Deep Vein Server running on port ${PORT}`);
  console.log(`✅ Connected to Supabase`);
});
