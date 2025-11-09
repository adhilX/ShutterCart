const Product = require("../../models/productSchema");
const Category = require("../../models/categorySchema");
const Brand = require("../../models/brandSchema");
const mongoose = require('mongoose')
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const product = require("../../models/productSchema");
 
const getProductAddPage = async (req, res) => {
  try {
    const category = await Category.find({ isListed: true });
    const brand = await Brand.find({ isBlocked: false });
    return res.render("product-add", {
      cat: category,
      brand: brand,
      activePage: 'products'
    });
  } catch (error) {
    res.redirect("/admin/pageerror");
    console.log(error)
  }
};

const addProducts = async (req, res) => {
  try {
    const productData = req.body;

    // Check for existing product with case-insensitive comparison
    const existingProduct = await Product.findOne({
      productName: { $regex: new RegExp(`^${productData.productName}$`, 'i') }
    });
    
    if (existingProduct) {
      return res.status(409).json({
        success: false,
        message: "A product with this name already exists. Please use a different name."
      });
    }

    const processedImages = [];
    if (req.files && req.files.length > 0) {
      const uploadDirectory = path.join("public", "uploads", "product-images");

      if (!fs.existsSync(uploadDirectory)) {
        fs.mkdirSync(uploadDirectory, { recursive: true });
      }

      for (let i = 0; i < req.files.length; i++) {
        const originalImagePath = req.files[i].path;
        const fileExtension = path.extname(req.files[i].originalname);
        const uniqueFileName = `${Date.now()}-${i}${fileExtension}`;
        const resizedImagePath = path.join(uploadDirectory, uniqueFileName);

        await sharp(originalImagePath)
          .resize({ width: 440, height: 440, fit: sharp.fit.cover })
          .sharpen({ sigma: 1.5 })
          .jpeg({ quality: 95 })
          .toColourspace('srgb')
          .toFile(resizedImagePath);

        processedImages.push(`/uploads/product-images/${uniqueFileName}`);
      }
    }

    const category = await Category.findOne({ name: productData.category });
    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Invalid category name"
      });
    }

    const newProduct = new Product({
      productName: productData.productName,
      description: productData.description,
      brand: productData.brand,
      category: category._id,
      regularPrice: productData.regularPrice,
      salePrice: productData.salePrice,
      quantity: productData.quantity,
      productImage: processedImages,
      status: "Available",
    });

    await newProduct.save();
    return res.status(200).json({
      success: true,
      message: "Product added successfully"
    });
  } catch (error) {
    console.error("Error while adding product:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while adding the product"
    });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const search = req.query.search || "";
    const page = req.query.page || 1;
    const limit = 6;
    const skip = (page - 1) * limit;

    const productQuery = {
      $or: [
        { productName: { $regex: new RegExp(".*" + search + ".*", "i") } },
        { brand: { $regex: new RegExp(".*" + search + ".*", "i") } },
      ],
    };

    const productData = await Product.find(productQuery)
      .limit(limit * 1)
      .skip(skip)
      .populate("category")
      .exec();

    const count = await Product.find(productQuery).countDocuments();

    const category = await Category.find({ isListed: true });
    const brand = await Brand.find({ isBlocked: false });

    res.render("products", {
      data: productData,
      search: search,
      currectPage: page,
      totalPages: Math.ceil(count / limit),
      cat: category,
      brand: brand,
      activePage: 'products'
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.redirect("/admin/pageerror");
  }
};

const blockProduct = async (req, res) => {
  try {
    const { id , currectPage , search} = req.query;

    if (!id) {
      console.error("Error: No product ID provided for blocking.");
      return res.status(400).send("Product ID is required.");
    }

    const result = await Product.updateOne(
      { _id: id },
      { $set: { isBlocked: true } }
    );
    console.log(`Success: Product with ID ${id} has been blocked.`);

    return res.redirect(`/admin/products?page=${currectPage}&search=${search}`);
  } catch (error) {
    console.error("Error in blockProduct:", error.message);
    res.status(500).redirect("/admin/pageerror");
  }
};

const unblockProduct = async (req, res) => {
  try {
    const { id , currectPage , search} = req.query;

    if (!id) {
      console.error("Error: No product ID provided for unblocking.");
      return res.status(400).send("Product ID is required.");
    }

    const result = await Product.updateOne(
      { _id: id },
      { $set: { isBlocked: false } }
    );
    console.log(`Success: Product with ID ${id} has been unblocked.`);

    return res.redirect(`/admin/products?page=${currectPage}&search=${search}`);
  } catch (error) {
    console.error("Error in unblockProduct:", error.message);
    res.status(500).redirect("/admin/pageerror");
  }
};

// Get Edit Products Page
const getEditProducts = async (req, res) => {
  try {
    const id = req.query.id;
    const product = await Product.findById(id).populate("category");
    if (!product) {
      return res.status(404).send("Product not found");
    }

    const brand = await Brand.find();
    const category = await Category.find({ isListed: true });

    return res.render("edit-Product", {
      product,
      cat: category,
      brand,
      activePage: 'products'
    });
  } catch (error) {
    console.error("Error in getEditProduct:", error.message);
    res.status(500).redirect("/admin/pageerror");
  }
};
// Edit Product
const editProducts = async (req, res) => {
  try {
    const id = req.params.id;
    const data = req.body;

    // Fetch the existing product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Validate the category
    const category = await Category.findOne({ name: data.category });
    if (!category) {
      return res.status(400).json({ message: "Invalid category" });
    }

    // Check for duplicate product names
    const existingProduct = await Product.findOne({
      productName: { $regex: `^${data.productName}$`, $options: "i" },
      _id: { $ne: id },
    });

    if (existingProduct) {
      return res.status(400).json({
        message: "Product with this name already exists. Please try another name.",
      });
    }

    // Process new cropped images
    let newImages = [];
    const croppedImagesCount = parseInt(data.croppedImagesCount) || 0;
    
    if (croppedImagesCount > 0) {
      const uploadDir = path.join("public", "uploads", "product-images");
      await fs.promises.mkdir(uploadDir, { recursive: true });

      // Process each image separately
      for (let i = 0; i < croppedImagesCount; i++) {
        const base64Image = data[`croppedImage${i}`];
        if (base64Image) {
          const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const uniqueName = `${Date.now()}-${i}.jpeg`;
          const imagePath = path.join(uploadDir, uniqueName);

          await sharp(imageBuffer)
            .resize({ width: 440, height: 440, fit: sharp.fit.cover })
            .jpeg({ quality: 80 })
            .toFile(imagePath);

          newImages.push(`/uploads/product-images/${uniqueName}`);
        }
      }
    }

    // Get remaining images from the form
    let currentImages = [];
    if (data.remainingImages) {
      currentImages = JSON.parse(data.remainingImages);
    }

    // Combine remaining and new images
    const finalImages = [...currentImages, ...newImages];

    // Ensure there is at least one image
    if (finalImages.length === 0) {
      return res.status(400).json({ message: "Product must have at least one image" });
    }

    // Prepare fields to update
    const updateFields = {
      productName: data.productName,
      description: data.description,
      brand: data.brand,
      category: category._id,
      regularPrice: data.regularPrice,
      salePrice: data.salePrice,
      quantity: data.quantity,
      productImage: finalImages,
    };

    // Update the product
    const updatedProduct = await Product.findByIdAndUpdate(id, updateFields, {
      new: true,
    });

    if (!updatedProduct) {
      return res.status(500).json({ message: "Failed to update the product." });
    }

    // Return success response
    res.json({ success: true });
    
  } catch (error) {
    console.error("Error in EditProduct:", error.message);
    res.status(500).json({ message: "An error occurred while updating the product." });
  }
};


// Add Product Offer
const addProductOffer = async (req, res) => {
  try {
    const { productId, percentage } = req.body;
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const category = await Category.findById(product.category);
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

 const result = await Product.findByIdAndUpdate(productId,{$set:{productOffer:percentage}},{new:true});

 if(result){
    res.json({ success: true, message: "Product offer added successfully" });
  } 
  else{
    res.status(500).json({ success: false, message: "product not found" });
  }
  }catch (error) {
    console.error("Error in addProductOffer:", error);
    res.status(500).redirect("/admin/pageerror");
  }

};

// Remove Product Offer
const removeProductOffer = async (req, res) => {
  try {
    const { productId } = req.body;
     const result = await Product.updateOne({_id:productId},{$set:{productOffer:0}});

    if(result.modifiedCount > 0) {
      res.json({ success: true, message: "Product offer removed successfully" });
    } else {
      res.status(500).json({ success: false, message: "Product not found" });
    }

   }catch (error) {
    console.error("Error in removeProductOffer:", error.message);
    res.status(500).redirect("/admin/pageerror");
  }
}
module.exports = {
  getProductAddPage,
  addProducts,
  getAllProducts,
  blockProduct,
  unblockProduct,
  getEditProducts,
  editProducts,
  addProductOffer,
  removeProductOffer,
};
