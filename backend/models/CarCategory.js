const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const carCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      index: true,
    },
  },
  { timestamps: true },
);

carCategorySchema.pre('validate', function normalizeCategoryFields() {
  const normalizedName = normalizeCompactText(this.name);
  this.name = normalizedName;
  this.nameKey = normalizedName.toLowerCase();
});

carCategorySchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });
carCategorySchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('CarCategory', carCategorySchema);
