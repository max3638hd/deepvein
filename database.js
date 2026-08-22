const mongoose = require('mongoose');

// نموذج اللاعب
const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true },
  username: String,
  firstName: String,
  lastName: String,
  
  // الرصيد والمستوى
  ore: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  miningPower: { type: Number, default: 2 },
  energyMax: { type: Number, default: 1000 },
  energy: { type: Number, default: 1000 },
  lastEnergyRefill: { type: Date, default: Date.now },
  
  // الدعوات
  referralCount: { type: Number, default: 0 },
  referredBy: { type: Number, default: null },
  referralReward: { type: Number, default: 0 },
  
  // المهام
  completedTasks: [String],
  dailyTasksReset: { type: Date, default: Date.now },
  
  // الترقيات والجوائز
  upgrades: {
    goldenPickaxe: { type: Boolean, default: false },
    energyBoost: { type: Boolean, default: false },
    royalTitle: { type: Boolean, default: false }
  },
  
  // السحب
  pendingWithdrawal: { type: Number, default: 0 },
  totalWithdrawn: { type: Number, default: 0 },
  withdrawalRequests: [{
    amount: Number,
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    method: String,
    requestDate: { type: Date, default: Date.now },
    processedDate: Date,
    notes: String
  }],
  
  // التحقق من الهوية
  identityVerified: { type: Boolean, default: false },
  
  // الأوقات
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now }
});

// نموذج المهام اليومية
const taskSchema = new mongoose.Schema({
  taskId: { type: String, unique: true, required
