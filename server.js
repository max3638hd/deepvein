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
        username:
