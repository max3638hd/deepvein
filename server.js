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

// VIP Prices (USD)
const VIP_PRICES = { bronze: 5, gold: 10 };
// Boost cost in ORE
const BOOST_COST = 200;
const BOOST_DURATION_MS = 3600000; // 1 hour

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
        boost_expiry: null,
      })
      .select();

    if (error) throw error;
    res.json({ success: true, user: data[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ Mining with VIP & BOOST support
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
    if (user.energy <= 0) return res.json({ success: false, message: 'Not enough energy' });

    // 1. Check VIP expiry
    let vipLevel = user.vip_level || 'none';
    if (vipLevel !== 'none' && user.vip_expiry && new Date(user.vip_expiry) < new Date()) {
      await supabase.from('users').update({ vip_level: 'none', vip_expiry: null }).eq('telegram_id', telegramId);
      vipLevel = 'none';
    }

    // 2. Check Boost expiry
    let isBoostActive = false;
    if (user.boost_expiry && new Date(user.boost_expiry) > new Date()) {
      isBoostActive = true;
    } else if (user.boost_expiry) {
      await supabase.from('users').update({ boost_expiry: null }).eq('telegram_id', telegramId);
    }

    // 3. Calculate ORE per tap
    let orePerTap = ORE_PER_TAP; // 2
    if (vipLevel === 'bronze') orePerTap = 3;
    if (vipLevel === 'gold') orePerTap = 4;
    if (isBoostActive) orePerTap = orePerTap * 2; // Double the reward

    // 4. Update database
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

// ============================================================
// ✅ Boost Activation
// ============================================================
app.post('/api/boost/activate', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

    if (userError || !user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.ore < BOOST_COST) return res.json({ success: false, message: `ليس لديك ${BOOST_COST} ORE كافية` });

    if (user.boost_expiry && new Date(user.boost_expiry) > new Date()) {
      return res.json({ success: false, message: 'المضاعف مفعل بالفعل!' });
    }

    const boostExpiry = new Date(Date.now() + BOOST_DURATION_MS);

    await supabase
      .from('users')
      .update({
        ore: user.ore - BOOST_COST,
        boost_expiry: boostExpiry,
      })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `🚀 تم تفعيل المضاعف لمدة ساعة! (خصم ${BOOST_COST} ORE)` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================

// ============================================================
// ✅ VIP Purchase (Manual confirmation simulation)
// ============================================================
app.post('/api/vip/purchase', async (req, res) => {
  try {
    const { telegramId, level } = req.body;
    const price = VIP_PRICES[level];
    if (!price) return res.json({ success: false, message: 'رتبة VIP غير صحيحة' });

    await supabase
      .from('vip_purchases')
      .insert({
        telegram_id: telegramId,
        level: level,
        amount: price,
        status: 'pending',
        created_at: new Date()
      });

    res.json({ 
      success: true, 
      message: `✅ تم إرسال طلب شراء VIP ${level}. سيتم تفعيله يدوياً قريباً. (الرجاء التواصل مع المالك)`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ Admin: Confirm VIP (Secret endpoint for you to test)
// ============================================================
app.post('/api/vip/confirm', async (req, res) => {
  try {
    const { telegramId, level } = req.body;
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1);

    await supabase
      .from('users')
      .update({
        vip_level: level,
        vip_expiry: expiryDate,
      })
      .eq('telegram_id', telegramId);

    res.json({ success: true, message: `✅ تم تفعيل VIP ${level} لمدة شهر!` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================

// Get Tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const { telegramId } = req.query;
    const { data: tasks, error } = await supabase.from('tasks').select('*');
    if (error) throw error;
    if (!telegramId) return res.json({ success: true, tasks });

    const { data: completed, error: completedError } = await supabase
      .from('completed_tasks')
      .select('task_id')
      .eq('telegram_id', telegramId);

    if (completedError) throw completedError;
    const completedIds = new Set((completed || []).map(c => c.task_id));
    const tasksWithStatus = tasks.map(t => ({ ...t, completed: completedIds.has(t.id) }));
    res.json({ success: true, tasks: tasksWithStatus });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Complete Task
app.post('/api/task/complete', async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;
    if (!telegramId || !taskId) return res.status(400).json({ success: false, message: 'Missing data' });

    const { data: alreadyDone, error: checkError } = await supabase
      .from('completed_tasks')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('task_id', taskId)
      .maybeSingle();

    if (checkError) throw checkError;
    if (alreadyDone) return res.json({ success: false, message: 'Task already completed' });

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    if (userError) throw userError;

    const { data: task, error: taskError } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (taskError) throw taskError;

    const reward = task.reward || 100;

    const { error: insertError } = await supabase.from('completed_tasks').insert({ telegram_id: telegramId, task_id: taskId });
    if (insertError) return res.json({ success: false, message: 'Task already completed' });

    await supabase.from('users').update({ ore: user.ore + reward, total_earned: (user.total_earned || 0) + reward }).eq('telegram_id', telegramId);
    res.json({ success: true, message: `Task completed! +${reward} ORE` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ Referral Link (تم تصحيح الرابط)
// ============================================================
app.get('/api/referral/link/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const referralLink = `https://t.me/nabdbooks_bot?start=${telegramId}`;
    res.json({ success: true, referralLink });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================

// Create Referral
app.post('/api/referral/invite', async (req, res) => {
  try {
    const { referrerTelegramId, referredTelegramId } = req.body;
    if (referrerTelegramId === referredTelegramId) return res.json({ success: false, message: 'Cannot refer yourself' });

    const { error: insertError } = await supabase.from('referrals').insert({ referrer_telegram_id: referrerTelegramId, referred_telegram_id: referredTelegramId });
    if (insertError) return res.json({ success: false, message: 'Referral already recorded' });

    const { data: referrer } = await supabase.from('users').select('*').eq('telegram_id', referrerTelegramId).single();
    const { data: referred } = await supabase.from('users').select('*').eq('telegram_id', referredTelegramId).single();

    await supabase.from('users').update({ ore: referrer.ore + REFERRAL_REWARD_REFERRER, referral_count: referrer.referral_count + 1 }).eq('telegram_id', referrerTelegramId);
    await supabase.from('users').update({ ore: referred.ore + REFERRAL_REWARD_REFERRED }).eq('telegram_id', referredTelegramId);

    res.json({ success: true, message: 'Referral bonus awarded!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Buy Upgrade
app.post('/api/store/upgrade', async (req, res) => {
  try {
    const { telegramId, upgradeId } = req.body;
    const { data: user } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    const upgradeCosts = { energy_boost: 100, ore_multiplier: 500 };
    const cost = upgradeCosts[upgradeId] || 0;
    if (user.ore < cost) return res.json({ success: false, message: 'Not enough ORE' });

    await supabase.from('users').update({ ore: user.ore - cost }).eq('telegram_id', telegramId);
    res.json({ success: true, message: `Upgrade purchased! -${cost} ORE` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// ✅ Withdrawal with 5% fee
// ============================================================
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { telegramId, amount, walletAddress } = req.body;
    if (!walletAddress) return res.json({ success: false, message: 'يرجى إدخال عنوان محفظتك' });

    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    if (userError || !user) return res.json({ success: false, message: 'المستخدم غير موجود' });
    if (amount < MIN_WITHDRAWAL) return res.json({ success: false, message: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL} ORE` });
    if (user.ore < amount) return res.json({ success: false, message: 'رصيدك غير كافي' });

    const fee = amount * 0.05;
    const netAmount = amount - fee;

    await supabase.from('users').update({ ore: user.ore - amount, pending_withdrawal: (user.pending_withdrawal || 0) + netAmount }).eq('telegram_id', telegramId);
    await supabase.from('withdrawals').insert({ telegram_id: telegramId, amount: netAmount, fee: fee, wallet_address: walletAddress, status: 'pending', created_at: new Date() });

    res.json({ success: true, message: `✅ تم طلب السحب بنجاح!\nالمبلغ الصافي: ${netAmount} ORE\nالرسوم: ${fee} ORE (5%)` });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ في الخادم' });
  }
});
// ============================================================

// ============================================================
// ✅ Ad Reward
// ============================================================
app.post('/api/ad/reward', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const AD_REWARD_ORE = 200;
    const { data: user, error: userError } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
    if (userError || !user) return res.status(404).json({ success: false, message: 'User not found' });

    await supabase.from('users').update({ ore: user.ore + AD_REWARD_ORE, total_earned: (user.total_earned || 0) + AD_REWARD_ORE }).eq('telegram_id', telegramId);
    res.json({ success: true, message: `+${AD_REWARD_ORE} ORE من الإعلان` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// ============================================================

// Get Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('username, ore, level').order('ore', { ascending: false }).limit(50);
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
    const { data, error } = await supabase.from('users').select('*').eq('telegram_id', telegramId).single();
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
