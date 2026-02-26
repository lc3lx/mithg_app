const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");
const GalleryViewRequest = require("../models/galleryViewRequestModel");
const {
  createGalleryViewRequestNotification,
  createGalleryViewAcceptedNotification,
  createGalleryViewRejectedNotification,
} = require("./notificationService");

// @desc    Send gallery view request
// @route   POST /api/v1/users/gallery-view-request/:userId
// @access  Private
exports.sendGalleryViewRequest = asyncHandler(async (req, res, next) => {
  const { userId: ownerId } = req.params;
  const requesterId = req.user._id.toString();

  const owner = await User.findById(ownerId).select("friends");
  if (!owner) {
    return next(new ApiError("User not found", 404));
  }

  if (ownerId === requesterId) {
    return next(new ApiError("You cannot request your own gallery", 400));
  }

  const isFriend = (owner.friends || []).some((f) => f.toString() === requesterId);
  if (isFriend) {
    return next(new ApiError("Friends can view gallery directly", 400));
  }

  const existing = await GalleryViewRequest.findOne({
    ownerId,
    requesterId: req.user._id,
    status: "pending",
  });
  if (existing) {
    return next(new ApiError("You already have a pending gallery view request", 400));
  }

  const request = await GalleryViewRequest.create({
    ownerId,
    requesterId: req.user._id,
    status: "pending",
  });

  await createGalleryViewRequestNotification(req.user._id, ownerId);

  res.status(201).json({
    message: "Gallery view request sent successfully",
    data: request,
  });
});

// @desc    Get gallery view requests (incoming and outgoing)
// @route   GET /api/v1/users/gallery-view-requests
// @access  Private
exports.getGalleryViewRequests = asyncHandler(async (req, res, next) => {
  const me = req.user._id;

  const [incoming, outgoing] = await Promise.all([
    GalleryViewRequest.find({ ownerId: me, status: "pending" })
      .sort({ createdAt: -1 })
      .populate("requesterId", "name profileImg age gender"),
    GalleryViewRequest.find({ requesterId: me })
      .sort({ createdAt: -1 })
      .populate("ownerId", "name profileImg age gender"),
  ]);

  const incomingList = incoming.map((r) => ({
    id: r._id,
    requester: r.requesterId,
    status: r.status,
    usedAt: r.usedAt,
    createdAt: r.createdAt,
  }));

  const outgoingList = outgoing.map((r) => ({
    id: r._id,
    owner: r.ownerId,
    status: r.status,
    usedAt: r.usedAt,
    createdAt: r.createdAt,
  }));

  res.status(200).json({
    data: {
      incoming: incomingList,
      outgoing: outgoingList,
    },
  });
});

// @desc    Accept gallery view request
// @route   POST /api/v1/users/gallery-view-request/:requestId/accept
// @access  Private
exports.acceptGalleryViewRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  const ownerId = req.user._id;

  const request = await GalleryViewRequest.findOne({
    _id: requestId,
    ownerId,
    status: "pending",
  });

  if (!request) {
    return next(new ApiError("Request not found or already processed", 404));
  }

  request.status = "accepted";
  await request.save();

  await createGalleryViewAcceptedNotification(ownerId, request.requesterId);

  res.status(200).json({
    message: "Gallery view request accepted",
    data: request,
  });
});

// @desc    Reject gallery view request
// @route   POST /api/v1/users/gallery-view-request/:requestId/reject
// @access  Private
exports.rejectGalleryViewRequest = asyncHandler(async (req, res, next) => {
  const { requestId } = req.params;
  const ownerId = req.user._id;

  const request = await GalleryViewRequest.findOne({
    _id: requestId,
    ownerId,
    status: "pending",
  });

  if (!request) {
    return next(new ApiError("Request not found or already processed", 404));
  }

  request.status = "rejected";
  await request.save();

  await createGalleryViewRejectedNotification(ownerId, request.requesterId);

  res.status(200).json({
    message: "Gallery view request rejected",
    data: request,
  });
});
