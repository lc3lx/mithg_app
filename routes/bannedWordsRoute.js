const express = require("express");

const {
  addBannedWord,
  getBannedWords,
  updateBannedWord,
  deleteBannedWord,
  toggleBannedWord,
  bulkAddBannedWords,
  getBannedWordsStats,
  exportBannedWords,
} = require("../services/bannedWordsService");

const {
  addBannedWordValidator,
  updateBannedWordValidator,
  bulkAddBannedWordsValidator,
} = require("../utils/validators/bannedWordsValidator");

const router = express.Router();

// Check for manageBannedWords permission (admin auth already handled by parent route)
router.use((req, res, next) => {
  if (!req.admin.permissions.manageBannedWords) {
    return res.status(403).json({
      message: "You don't have permission to manage banned words",
    });
  }
  next();
});

// Routes
router
  .route("/")
  .get(getBannedWords)
  .post(addBannedWordValidator, addBannedWord);

router.post("/bulk", bulkAddBannedWordsValidator, bulkAddBannedWords);

router
  .route("/:id")
  .put(updateBannedWordValidator, updateBannedWord)
  .delete(deleteBannedWord);

router.put("/:id/toggle", toggleBannedWord);

router.get("/stats/summary", getBannedWordsStats);
router.get("/export/all", exportBannedWords);

module.exports = router;
