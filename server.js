const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const { User, Task, Referral, Stats } = require('./database');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// الثوابت
const BOT_TOKEN = process.env.BOT_TOKEN;
const ORE_PER_TAP = 2;
const ENERGY_MAX = 1000;
const ENERGY_REFILL_RATE = 10;
const REFERRAL_REWARD_REFERRER = 500;
const REFERRAL_REWARD_REFERRED = 300;
const MIN_WITHDRAWAL = 20;
const WITHDRAWAL_THRESHOLD_LEVEL = 5;
const MIN_REFERRALS = 10;

// ============ اتصال قاعدة البيانات ============
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ============ دوال مساعدة ============

function calculateEnergy(user) {
  const now = new Date();
  const timeDiff = (now - user.lastEnergyRefill) / 1000;
  const energyRegen = Math.min(timeDiff * ENERGY_REFILL_RATE, ENERGY_MAX - user.energy);
  return user.energy + energyRegen;
}

// ============ API Endpoints ============

// 1️⃣ تسجيل / تحديث المستخدم
app.post('/api/user/register', async (req, res) => {
  try {
    const { webAppData } = req.body;
    
    const urlParams = new URLSearchParams(webAppData);
    const userDataStr = urlParams.get('user');
    const userData = JSON.parse(userDataStr);
    
    const { id, username, first_name, last_name } = userData;
    
    let user = await User.findOne({ telegramId: id });
    
    if (!user) {
      user = new User({
        telegramId: id,
        username: username || `user_${id}`,
        firstName: first_name,
        lastName: last_name
      });
      await user.save();
    } else {
      user.lastActive = new Date();
      await user.save();
    }
    
    res.json({
      success: true,
      user: {
        telegramId: user.telegramId,
        ore: user.ore,
        level: user.level,
        miningPower: user.upgrades.goldenPickaxe ? ORE_PER_TAP * 2 : ORE_PER_TAP,
        energy: calculateEnergy(user),
        energyMax: ENERGY_MAX,
        referralCount: user.referralCount,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2️⃣ النقر على الفأس (التعدين)
app.post('/api/mining/tap', async (req, res) => {
  try {
    const { telegramId } = req.body;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const currentEnergy = calculateEnergy(user);
    
    if (currentEnergy < 1) {
      return res.json({ success: false, message: 'Not enough energy' });
    }
    
    const reward = user.upgrades.goldenPickaxe ? ORE_PER_TAP * 2 : ORE_PER_TAP;
    user.ore += reward;
    user.energy = currentEnergy - 1;
    user.lastEnergyRefill = new Date();
    
    await user.save();
    
    if (user.ore >= user.level * 10000) {
      user.level += 1;
      user.miningPower = ORE_PER_TAP + (user.level - 1) * 0.5;
      await user.save();
    }
    
    res.json({
      success: true,
      ore: user.ore,
      energy: user.energy,
      level: user.level
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3️⃣ المهام اليومية
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await Task.find({ isActive: true });
    res.json({ tasks });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4️⃣ إكمال مهمة
app.post('/api/task/complete', async (req, res) => {
  try {
    const { telegramId, taskId } = req.body;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.completedTasks.includes(taskId)) {
      return res.json({ success: false, message: 'Task already completed today' });
    }
    
    const task = await Task.findOne({ taskId });
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    user.ore += task.reward;
    user.completedTasks.push(taskId);
    await user.save();
    
    res.json({
      success: true,
      reward: task.reward,
      totalOre: user.ore
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5️⃣ نظام الدعوات
app.post('/api/referral/invite', async (req, res) => {
  try {
    const { referrerId, referredUserId } = req.body;
    
    const referrer = await User.findOne({ telegramId: referrerId });
    const referred = await User.findOne({ telegramId: referredUserId });
    
    if (!referrer || !referred) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const existing = await Referral.findOne({ referrerId, referredUserId });
    if (existing) {
      return res.json({ success: false, message: 'Already referred' });
    }
    
    const referral = new Referral({ referrerId, referredUserId, referredUsername: referred.username });
    await referral.save();
    
    referrer.ore += REFERRAL_REWARD_REFERRER;
    referrer.referralCount += 1;
    referred.ore += REFERRAL_REWARD_REFERRED;
    referred.referredBy = referrerId;
    
    await referrer.save();
    await referred.save();
    
    res.json({
      success: true,
      referrerReward: REFERRAL_REWARD_REFERRER,
      referredReward: REFERRAL_REWARD_REFERRED
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6️⃣ الحصول على رابط الدعوة
app.get('/api/referral/link/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const referralLink = `https://t.me/${process.env.BOT_USERNAME}?start=r_${telegramId}`;
    
    res.json({
      link: referralLink,
      referralCount: user.referralCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7️⃣ الترقيات (شراء من المتجر)
app.post('/api/store/upgrade', async (req, res) => {
  try {
    const { telegramId, upgradeType } = req.body;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const upgradeCosts = {
      goldenPickaxe: 10000,
      energyBoost: 2500,
      royalTitle: 50000
    };
    
    const cost = upgradeCosts[upgradeType];
    if (!cost) return res.status(400).json({ error: 'Invalid upgrade type' });
    
    if (user.ore < cost) {
      return res.json({ success: false, message: 'Not enough ORE' });
    }
    
    user.ore -= cost;
    user.upgrades[upgradeType] = true;
    await user.save();
    
    res.json({
      success: true,
      message: `Upgrade ${upgradeType} purchased!`,
      remainingOre: user.ore
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8️⃣ طلب سحب
app.post('/api/withdrawal/request', async (req, res) => {
  try {
    const { telegramId, amount, method } = req.body;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (user.level < WITHDRAWAL_THRESHOLD_LEVEL) {
      return res.json({ success: false, message: `Need level ${WITHDRAWAL_THRESHOLD_LEVEL}` });
    }
    
    if (user.referralCount < MIN_REFERRALS) {
      return res.json({ success: false, message: `Need ${MIN_REFERRALS} referrals` });
    }
    
    if (!user.identityVerified) {
      return res.json({ success: false, message: 'Identity verification required' });
    }
    
    if (amount < MIN_WITHDRAWAL) {
      return res.json({ success: false, message: `Minimum withdrawal: $${MIN_WITHDRAWAL}` });
    }
    
    user.withdrawalRequests.push({
      amount,
      status: 'pending',
      method
    });
    
    await user.save();
    
    res.json({
      success: true,
      message: 'Withdrawal request submitted',
      requestId: user.withdrawalRequests[user.withdrawalRequests.length - 1]._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9️⃣ الحصول على بيانات المستخدم (Dashboard)
app.get('/api/user/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const user = await User.findOne({ telegramId });
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    res.json({
      telegramId: user.telegramId,
      username: user.username,
      ore: user.ore,
      level: user.level,
      energy: calculateEnergy(user),
      energyMax: ENERGY_MAX,
      referralCount: user.referralCount,
      upgrades: user.upgrades,
      withdrawalRequests: user.withdrawalRequests,
      identityVerified: user.identityVerified,
      totalWithdrawn: user.totalWithdrawn
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🔟 Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const topUsers = await User.find()
      .sort({ referralCount: -1 })
      .limit(10)
      .select('username referralCount');
    
    res.json({ leaderboard: topUsers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// صحة السيرفر
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// تشغيل السيرفر
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Deep Vein Backend running on port ${PORT}`);
});
