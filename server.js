const express = require('express');
const setupBot = require('./bot');
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
const MIN_WITHDRAWAL = 1000; 
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

    const { data: existing } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (existing) {
      return res.json({ success: true, user: existing });
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_id: telegramId,
        username: username || `user_${telegramId}`,
        ore: 0,
        energy: ENERGY_MAX,
        level: 1,
        referral_count: 0,
        total_earned: 0,
        last_tap: new Date(),
        vip_level: 'none',
        vip_expiry: null,
      })
      .select();

    if (error) throw error;
    res.json({ success: true, user: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ تم تعديل دالة التعدين لدعم VIP (برونز 3، ذهبي 4)
// ============================================================
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

    let vipLevel = user.vip_level || 'none';
    if (vipLevel !== 'none' && user.vip_expiry && new Date(user.vip_expiry) < new Date()) {
      await supabase
        .from('users')
        .update({ vip_level: 'none', vip_expiry: null })
        .eq('telegram_id', telegramId);
      vipLevel = 'none';
    }

    let orePerTap = ORE_PER_TAP;
    if (vipLevel === 'bronze') orePerTap = 3;
    if (vipLevel === 'gold') orePerTap = 4;

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({
        ore: user.ore + orePerTap,
        energy: Math.max(0, user.energy - 1),
        total_earned: (user.total_earned || 0) + orePerTap,
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
// ============================================================

// Get Tasks (with completion status for this user)
app.get('/api/tasks', async (req, res) => {
  try {
    const { telegramId } = req.query;

    const { data: tasks, error } = await supabase
      .from('tasks')
      .select('*');

    if (error) throw error;

    if (!telegramId) {
      return res.json({ success: true, tasks });
    }

    const { data: completed, error: completedError } = await supabase
      .from('completed_tasks')
      .select('task_id')
      .eq('telegram_id', telegramId);

    if (completedError) throw completedError;

    const completedIds = new Set((completed || []).map(c => c.task_id));
    const tasksWithStatus = tasks.map(t => ({
      ...t,
      completed: completedIds.has(t.id),
    }));

    res.json({ success: true, tasks: tasksWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Complete Task (prevents duplicate claims)
app.post('/api/task/complete', async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;

    if (!telegramId || !taskId) {
      return res.status(400).json({ success: false, message: 'Missing telegramId or taskId' });
    }

    const { data: alreadyDone, error: checkError } = await supabase
      .from('completed_tasks')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('task_id', taskId)
      .maybeSingle();

    if (checkError) throw checkError;

    if (alreadyDone) {
      return res.json({ success: false, message: 'Task already completed' });
    }

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

    const reward = task.reward || 100;

    const { error: insertError } = await supabase
      .from('completed_tasks')
      .insert({ telegram_id: telegramId, task_id: taskId });

    if (insertError) {
      return res.json({ success: false, message: 'Task already completed' });
    }

    await supabase
      .from('users')
      .update({
        ore: user.ore + reward,
        total_earned: (user.total_earned || 0) + reward,
      })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `Task completed! +${reward} ORE` });
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

// Create Referral (prevents a referral pair from being rewarded twice)
app.post('/api/referral/invite', async (req, res) => {
  try {
    const { referrerTelegramId, referredTelegramId } = req.body;

    if (referrerTelegramId === referredTelegramId) {
      return res.json({ success: false, message: 'Cannot refer yourself' });
    }

    const { error: insertError } = await supabase
      .from('referrals')
      .insert({
        referrer_telegram_id: referrerTelegramId,
        referred_telegram_id: referredTelegramId,
      });

    if (insertError) {
      return res.json({ success: false, message: 'Referral already recorded' });
    }

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

// ============================================================
// ✅ دالة السحب مع رسوم 5%
// ============================================================
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { telegramId, amount, walletAddress } = req.body;

    if (!walletAddress) {
      return res.json({ success: false, message: 'يرجى إدخال عنوان محفظتك' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError || !user) {
      return res.json({ success: false, message: 'المستخدم غير موجود' });
    }

    if (amount < MIN_WITHDRAWAL) {
      return res.json({ success: false, message: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL} ORE` });
    }

    if (user.ore < amount) {
      return res.json({ success: false, message: 'رصيدك غير كافي' });
    }

    const fee = amount * 0.05;
    const netAmount = amount - fee;

    await supabase
      .from('users')
      .update({ 
        ore: user.ore - amount,
        pending_withdrawal: (user.pending_withdrawal || 0) + netAmount 
      })
      .eq('telegram_id', telegramId);

    await supabase
      .from('withdrawals')
      .insert({
        telegram_id: telegramId,
        amount: netAmount,
        fee: fee,
        wallet_address: walletAddress,
        status: 'pending',
        created_at: new Date()
      });

    res.json({ 
      success: true, 
      message: `✅ تم طلب السحب بنجاح!\nالمبلغ الصافي: ${netAmount} ORE\nالرسوم: ${fee} ORE (5%)` 
    });

  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
  }
});
// ============================================================

// ============================================================
// ✅ مكافأة مشاهدة الإعلان (يضيف 200 ORE للمستخدم)
// ============================================================
app.post('/api/ad/reward', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const AD_REWARD_ORE = 200; // ← غير هذا الرقم حسب رغبتك

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    await supabase
      .from('users')
      .update({
        ore: user.ore + AD_REWARD_ORE,
        total_earned: (user.total_earned || 0) + AD_REWARD_ORE,
      })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `+${AD_REWARD_ORE} ORE من الإعلان` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================

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
  setupBot(app);
});
