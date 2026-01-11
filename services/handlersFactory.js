const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

exports.deleteOne = (Model) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const document = await Model.findByIdAndDelete(id);

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    // Trigger "remove" event when update document
    document.remove();
    res.status(204).send();
  });

exports.updateOne = (Model) =>
  asyncHandler(async (req, res, next) => {
    const document = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!document) {
      return next(
        new ApiError(`No document for this id ${req.params.id}`, 404)
      );
    }
    // Trigger "save" event when update document
    document.save();
    res.status(200).json({ data: document });
  });

exports.createOne = (Model) =>
  asyncHandler(async (req, res) => {
    const newDoc = await Model.create(req.body);
    res.status(201).json({ data: newDoc });
  });

exports.getOne = (Model, populationOpt) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    // 1) Build query
    let query = Model.findById(id);
    if (populationOpt) {
      query = query.populate(populationOpt);
    }

    // 2) Execute query
    const document = await query;

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    // Convert to plain object and manually set image URLs for User model
    const documentObject = document.toObject();

    // For User model, manually set image URLs if they exist
    if (Model.modelName === 'User') {
      if (documentObject.profileImg && !documentObject.profileImg.startsWith('http')) {
        documentObject.profileImg = `${process.env.BASE_URL}/uploads/users/${documentObject.profileImg}`;
      }
      if (documentObject.coverImg && !documentObject.coverImg.startsWith('http')) {
        documentObject.coverImg = `${process.env.BASE_URL}/uploads/users/${documentObject.coverImg}`;
      }
    }

    res.status(200).json({ data: documentObject });
  });

exports.getAll = (Model, modelName = "") =>
  asyncHandler(async (req, res) => {
    let filter = {};
    if (req.filterObj) {
      filter = req.filterObj;
    }
    // Build query
    const documentsCounts = await Model.countDocuments(filter);
    const apiFeatures = new ApiFeatures(Model.find(filter), req.query)
      .paginate(documentsCounts)
      .filter()
      .search(modelName)
      .limitFields()
      .sort();

    // Execute query
    const { mongooseQuery, paginationResult } = apiFeatures;
    const documents = await mongooseQuery;

    res
      .status(200)
      .json({ results: documents.length, paginationResult, data: documents });
  });

// Get all with custom population
exports.getAllPopulated = (Model, modelName = "", population = []) =>
  asyncHandler(async (req, res) => {
    let filter = {};
    if (req.filterObj) {
      filter = req.filterObj;
    }
    // Build query
    const documentsCounts = await Model.countDocuments(filter);
    const apiFeatures = new ApiFeatures(Model.find(filter), req.query)
      .paginate(documentsCounts)
      .filter()
      .search(modelName)
      .limitFields()
      .sort();

    // Execute query
    const { mongooseQuery, paginationResult } = apiFeatures;
    let query = mongooseQuery;
    if (population && population.length > 0) {
      population.forEach((pop) => {
        query = query.populate(pop);
      });
    }
    const documents = await query;

    res
      .status(200)
      .json({ results: documents.length, paginationResult, data: documents });
  });

// Create one with population
exports.createOnePopulated = (Model, population = []) =>
  asyncHandler(async (req, res) => {
    const newDoc = await Model.create(req.body);
    let populatedDoc = newDoc;
    if (population && population.length > 0) {
      populatedDoc = await Model.findById(newDoc._id);
      population.forEach((pop) => {
        populatedDoc = populatedDoc.populate(pop);
      });
      populatedDoc = await populatedDoc;
    }
    res.status(201).json({ data: populatedDoc });
  });

// Update one with population
exports.updateOnePopulated = (Model, population = []) =>
  asyncHandler(async (req, res, next) => {
    const document = await Model.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!document) {
      return next(
        new ApiError(`No document for this id ${req.params.id}`, 404)
      );
    }

    let populatedDoc = document;
    if (population && population.length > 0) {
      populatedDoc = await Model.findById(document._id);
      population.forEach((pop) => {
        populatedDoc = populatedDoc.populate(pop);
      });
      populatedDoc = await populatedDoc;
    }

    res.status(200).json({ data: populatedDoc });
  });

// Get one with multiple populations
exports.getOneMultiplePop = (Model, populations = []) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    // 1) Build query
    let query = Model.findById(id);
    if (populations && populations.length > 0) {
      populations.forEach((pop) => {
        query = query.populate(pop);
      });
    }

    // 2) Execute query
    const document = await query;

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }
    res.status(200).json({ data: document });
  });

// Soft delete (deactivate)
exports.deactivateOne = (Model) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const document = await Model.findByIdAndUpdate(
      id,
      { active: false },
      { new: true }
    );

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    res.status(200).json({ data: document });
  });

// Toggle boolean field
exports.toggleField = (Model, fieldName) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const document = await Model.findById(id);

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    document[fieldName] = !document[fieldName];
    await document.save();

    res.status(200).json({
      message: `${fieldName} toggled successfully`,
      data: document,
    });
  });

// Add to array field
exports.addToArray = (Model, arrayField) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { itemId } = req.body;

    const document = await Model.findByIdAndUpdate(
      id,
      { $push: { [arrayField]: itemId } },
      { new: true }
    );

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    res.status(200).json({
      message: `Item added to ${arrayField} successfully`,
      data: document,
    });
  });

// Remove from array field
exports.removeFromArray = (Model, arrayField) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { itemId } = req.body;

    const document = await Model.findByIdAndUpdate(
      id,
      { $pull: { [arrayField]: itemId } },
      { new: true }
    );

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    res.status(200).json({
      message: `Item removed from ${arrayField} successfully`,
      data: document,
    });
  });

// Increment numeric field
exports.incrementField = (Model, fieldName) =>
  asyncHandler(async (req, res, next) => {
    const { id } = req.params;
    const { amount = 1 } = req.body;

    const document = await Model.findByIdAndUpdate(
      id,
      { $inc: { [fieldName]: amount } },
      { new: true }
    );

    if (!document) {
      return next(new ApiError(`No document for this id ${id}`, 404));
    }

    res.status(200).json({
      message: `${fieldName} incremented successfully`,
      data: document,
    });
  });
