const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const BannedWords = require("../models/bannedWordsModel");

// @desc    Add a new banned word
// @route   POST /api/v1/admin/banned-words
// @access  Private/Admin
exports.addBannedWord = asyncHandler(async (req, res, next) => {
  const {
    word,
    variations,
    category,
    severity,
    warningMessage,
    autoBlockThreshold,
    blockDurationHours,
    notes,
  } = req.body;

  const adminId = req.admin._id;

  // Check if word already exists
  const existingWord = await BannedWords.findOne({
    $or: [{ word: word.toLowerCase() }, { variations: word.toLowerCase() }],
  });

  if (existingWord) {
    return next(
      new ApiError(
        "This word or variation already exists in the banned words list",
        400
      )
    );
  }

  const bannedWord = await BannedWords.create({
    word: word.toLowerCase(),
    variations: variations ? variations.map((v) => v.toLowerCase()) : [],
    category: category || "profanity",
    severity: severity || "medium",
    warningMessage:
      warningMessage ||
      "تم اكتشاف محتوى غير مناسب. يرجى الحفاظ على المحادثة محترمة.",
    autoBlockThreshold: autoBlockThreshold || 3,
    blockDurationHours: blockDurationHours || 24,
    addedBy: adminId,
    notes,
  });

  res.status(201).json({
    message: "Banned word added successfully",
    data: bannedWord,
  });
});

// @desc    Get all banned words
// @route   GET /api/v1/admin/banned-words
// @access  Private/Admin
exports.getBannedWords = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    BannedWords.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .paginate(await BannedWords.countDocuments());

  // Custom search for banned words (search in word and variations)
  if (req.query.keyword || req.query.search) {
    const keyword = req.query.keyword || req.query.search;
    features.mongooseQuery = features.mongooseQuery.find({
      $or: [
        { word: { $regex: keyword, $options: 'i' } },
        { variations: { $regex: keyword, $options: 'i' } },
      ],
    });
  }

  const bannedWords = await features.mongooseQuery;

  // Ensure bannedWords is an array
  const bannedWordsArray = Array.isArray(bannedWords) ? bannedWords : [];

  // Get stats
  const totalWords = await BannedWords.countDocuments();
  const activeWords = await BannedWords.countDocuments({ isActive: true });
  const totalViolations = await BannedWords.aggregate([
    { $group: { _id: null, total: { $sum: "$violationCount" } } },
  ]);

  res.status(200).json({
    status: "success",
    results: bannedWordsArray.length,
    data: bannedWordsArray,
    stats: {
      total: totalWords,
      active: activeWords,
      totalViolations: totalViolations.length > 0 ? totalViolations[0].total : 0,
    },
  });
});

// @desc    Update banned word
// @route   PUT /api/v1/admin/banned-words/:id
// @access  Private/Admin
exports.updateBannedWord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const {
    word,
    variations,
    category,
    severity,
    warningMessage,
    autoBlockThreshold,
    blockDurationHours,
    isActive,
    notes,
  } = req.body;

  const bannedWord = await BannedWords.findById(id);
  if (!bannedWord) {
    return next(new ApiError("Banned word not found", 404));
  }

  // Check if new word conflicts with existing ones
  if (word && word.toLowerCase() !== bannedWord.word) {
    const existingWord = await BannedWords.findOne({
      $and: [
        { _id: { $ne: id } },
        {
          $or: [
            { word: word.toLowerCase() },
            { variations: word.toLowerCase() },
          ],
        },
      ],
    });

    if (existingWord) {
      return next(
        new ApiError("This word already exists in the banned words list", 400)
      );
    }
  }

  // Update fields
  if (word) bannedWord.word = word.toLowerCase();
  if (variations)
    bannedWord.variations = variations.map((v) => v.toLowerCase());
  if (category) bannedWord.category = category;
  if (severity) bannedWord.severity = severity;
  if (warningMessage) bannedWord.warningMessage = warningMessage;
  if (autoBlockThreshold) bannedWord.autoBlockThreshold = autoBlockThreshold;
  if (blockDurationHours) bannedWord.blockDurationHours = blockDurationHours;
  if (isActive !== undefined) bannedWord.isActive = isActive;
  if (notes !== undefined) bannedWord.notes = notes;

  await bannedWord.save();

  res.status(200).json({
    message: "Banned word updated successfully",
    data: bannedWord,
  });
});

// @desc    Delete banned word
// @route   DELETE /api/v1/admin/banned-words/:id
// @access  Private/Admin
exports.deleteBannedWord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const bannedWord = await BannedWords.findById(id);
  if (!bannedWord) {
    return next(new ApiError("Banned word not found", 404));
  }

  await BannedWords.findByIdAndDelete(id);

  res.status(200).json({
    message: "Banned word deleted successfully",
  });
});

// @desc    Toggle banned word status (activate/deactivate)
// @route   PUT /api/v1/admin/banned-words/:id/toggle
// @access  Private/Admin
exports.toggleBannedWord = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const bannedWord = await BannedWords.findById(id);
  if (!bannedWord) {
    return next(new ApiError("Banned word not found", 404));
  }

  bannedWord.isActive = !bannedWord.isActive;
  await bannedWord.save();

  res.status(200).json({
    message: `Banned word ${
      bannedWord.isActive ? "activated" : "deactivated"
    } successfully`,
    data: bannedWord,
  });
});

// @desc    Bulk add banned words
// @route   POST /api/v1/admin/banned-words/bulk
// @access  Private/Admin
exports.bulkAddBannedWords = asyncHandler(async (req, res, next) => {
  const { words, category, severity } = req.body;
  const adminId = req.admin._id;

  if (!words || !Array.isArray(words) || words.length === 0) {
    return next(new ApiError("Words array is required", 400));
  }

  const results = {
    added: [],
    skipped: [],
    errors: [],
  };

  for (const wordData of words) {
    try {
      const word = typeof wordData === "string" ? wordData : wordData.word;
      const variations = wordData.variations || [];

      // Check if word already exists
      const existingWord = await BannedWords.findOne({
        $or: [{ word: word.toLowerCase() }, { variations: word.toLowerCase() }],
      });

      if (existingWord) {
        results.skipped.push({
          word,
          reason: "Word already exists",
        });
        continue;
      }

      const bannedWord = await BannedWords.create({
        word: word.toLowerCase(),
        variations: variations.map((v) => v.toLowerCase()),
        category: wordData.category || category || "profanity",
        severity: wordData.severity || severity || "medium",
        addedBy: adminId,
      });

      results.added.push(bannedWord);
    } catch (error) {
      results.errors.push({
        word: wordData.word || wordData,
        error: error.message,
      });
    }
  }

  res.status(200).json({
    message: `Bulk operation completed. Added: ${results.added.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}`,
    data: results,
  });
});

// @desc    Get banned words statistics
// @route   GET /api/v1/admin/banned-words/stats
// @access  Private/Admin
exports.getBannedWordsStats = asyncHandler(async (req, res) => {
  const totalWords = await BannedWords.countDocuments();
  const activeWords = await BannedWords.countDocuments({ isActive: true });
  const inactiveWords = await BannedWords.countDocuments({ isActive: false });

  // Category breakdown
  const categoryStats = await BannedWords.aggregate([
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  // Severity breakdown
  const severityStats = await BannedWords.aggregate([
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);

  // Most violated words
  const mostViolated = await BannedWords.find({ violationCount: { $gt: 0 } })
    .sort({ violationCount: -1 })
    .limit(10)
    .select("word violationCount lastViolation category");

  res.status(200).json({
    data: {
      total: totalWords,
      active: activeWords,
      inactive: inactiveWords,
      categories: categoryStats,
      severities: severityStats,
      mostViolated,
    },
  });
});

// @desc    Export banned words
// @route   GET /api/v1/admin/banned-words/export
// @access  Private/Admin
exports.exportBannedWords = asyncHandler(async (req, res) => {
  const bannedWords = await BannedWords.find({ isActive: true })
    .select(
      "word variations category severity warningMessage autoBlockThreshold"
    )
    .sort({ word: 1 });

  res.status(200).json({
    results: bannedWords.length,
    data: bannedWords,
  });
});
