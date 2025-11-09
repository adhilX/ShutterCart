const Product = require('../../models/productSchema');
const Category = require('../../models/categorySchema');
const Brand = require('../../models/brandSchema');
const User = require('../../models/userSchema');
const Order = require('../../models/orderSchema');

// Helper function to get week number
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const loadDashboard = async (req, res) => {
    try {
        if (req.session.admin) {
            const timeFrame = req.query.timeFrame || 'monthly';
            console.log('Selected timeFrame:', timeFrame);

            // Get total sales
            let totalSales = await Order.aggregate([
                { $match: { status: 'Delivered' } },
                { $group: { _id: null, totalSales: { $sum: '$totalPrice' } } }
            ]);
            
            totalSales = totalSales.length > 0 ? totalSales[0].totalSales : 0;
            const totalUsers = await User.find().countDocuments();
            const totalOrders = await Order.find().countDocuments();
            const totalProducts = await Product.find().countDocuments();

            // Calculate date range based on timeFrame
            const endDate = new Date();
            const startDate = new Date();

            switch(timeFrame) {
                case 'yearly':
                    startDate.setFullYear(startDate.getFullYear() - 5);
                    break;
                case 'monthly':
                    startDate.setMonth(startDate.getMonth() - 11); // Last 12 months
                    break;
                case 'weekly':
                    startDate.setDate(startDate.getDate() - 90);
                    break;
                default: // daily
                    startDate.setDate(startDate.getDate() - 30);
            }

            // Get top 10 selling products (all-time)
            const topProducts = await Order.aggregate([
                { $match: { status: 'Delivered' } },
                { $unwind: '$orderedItems' },
                {
                    $group: {
                        _id: '$orderedItems.product',
                        name: { $first: '$orderedItems.productName' },
                        totalQuantity: { $sum: '$orderedItems.quantity' },
                        totalRevenue: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } }
                    }
                },
                { $sort: { totalQuantity: -1 } },
                { $limit: 10 }
            ]);

            // Get top 10 selling brands with date filter
            const topBrands = await Order.aggregate([
                { 
                    $match: { 
                        status: 'Delivered',
                        createdAt: { $gte: startDate, $lte: endDate }
                    } 
                },
                { $unwind: '$orderedItems' },
                {
                    $lookup: {
                        from: 'products',
                        localField: 'orderedItems.product',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: '$product' },
                {
                    $group: {
                        _id: '$product.brand',
                        name: { $first: '$product.brand' },
                        totalSales: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                        totalQuantity: { $sum: '$orderedItems.quantity' }
                    }
                },
                { $sort: { totalSales: -1 } },
                { $limit: 10 }
            ]);

            // Get category data with product counts and sales
            const categoryData = await Category.aggregate([
                {
                    $lookup: {
                        from: 'products',
                        localField: '_id',
                        foreignField: 'category',
                        as: 'products'
                    }
                },
                { $unwind: { path: '$products', preserveNullAndEmptyArrays: true } },
                {
                    $lookup: {
                        from: 'orders',
                        let: { productId: '$products._id' },
                        pipeline: [
                            {
                                $match: {
                                    status: 'Delivered'
                                }
                            },
                            { $unwind: '$orderedItems' },
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$orderedItems.product', '$$productId']
                                    }
                                }
                            },
                            {
                                $group: {
                                    _id: null,
                                    totalSales: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                                    totalQuantity: { $sum: '$orderedItems.quantity' }
                                }
                            }
                        ],
                        as: 'orderStats'
                    }
                },
                {
                    $group: {
                        _id: '$_id',
                        name: { $first: '$name' },
                        count: { $sum: 1 },
                        totalSales: {
                            $sum: {
                                $cond: [
                                    { $gt: [{ $size: '$orderStats' }, 0] },
                                    { $arrayElemAt: ['$orderStats.totalSales', 0] },
                                    0
                                ]
                            }
                        },
                        totalQuantity: {
                            $sum: {
                                $cond: [
                                    { $gt: [{ $size: '$orderStats' }, 0] },
                                    { $arrayElemAt: ['$orderStats.totalQuantity', 0] },
                                    0
                                ]
                            }
                        }
                    }
                },
                { $sort: { totalSales: -1 } }
            ]);

            console.log('Date Range:', { startDate, endDate });
            console.log('Top Products:', topProducts);
            console.log('Top Brands:', topBrands);
            console.log('Category Data:', categoryData);

            // Get sales data with proper date grouping
            let salesData = await Order.aggregate([
                {
                    $match: {
                        status: 'Delivered',
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                { $unwind: '$orderedItems' },
                {
                    $group: {
                        _id: {
                            $switch: {
                                branches: [
                                    {
                                        case: { $eq: [timeFrame, 'yearly'] },
                                        then: { $year: '$createdAt' }
                                    },
                                    {
                                        case: { $eq: [timeFrame, 'monthly'] },
                                        then: {
                                            year: { $year: '$createdAt' },
                                            month: { $month: '$createdAt' }
                                        }
                                    },
                                    {
                                        case: { $eq: [timeFrame, 'weekly'] },
                                        then: {
                                            year: { $year: '$createdAt' },
                                            week: { $week: '$createdAt' }
                                        }
                                    }
                                ],
                                default: {
                                    year: { $year: '$createdAt' },
                                    month: { $month: '$createdAt' },
                                    day: { $dayOfMonth: '$createdAt' }
                                }
                            }
                        },
                        amount: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                        productCount: { $sum: '$orderedItems.quantity' }
                    }
                },
                { $sort: { '_id': 1 } }
            ]);

            // Process and fill missing dates
            const processedData = [];
            let currentDate = new Date(startDate);

            while (currentDate <= endDate) {
                let matchingData;
                let dateKey;

                switch (timeFrame) {
                    case 'yearly':
                        dateKey = currentDate.getFullYear();
                        matchingData = salesData.find(item => item._id === dateKey);
                        processedData.push({
                            date: `${dateKey}-01-01`,
                            amount: matchingData ? matchingData.amount : 0,
                            productCount: matchingData ? matchingData.productCount : 0
                        });
                        currentDate.setFullYear(currentDate.getFullYear() + 1);
                        break;

                    case 'monthly':
                        dateKey = {
                            year: currentDate.getFullYear(),
                            month: currentDate.getMonth() + 1
                        };
                        matchingData = salesData.find(item =>
                            item._id.year === dateKey.year && 
                            item._id.month === dateKey.month
                        );
                        processedData.push({
                            date: `${dateKey.year}-${String(dateKey.month).padStart(2, '0')}-01`,
                            amount: matchingData ? matchingData.amount : 0,
                            productCount: matchingData ? matchingData.productCount : 0
                        });
                        currentDate.setMonth(currentDate.getMonth() + 1);
                        break;

                    case 'weekly':
                        dateKey = {
                            year: currentDate.getFullYear(),
                            week: getWeekNumber(currentDate)
                        };
                        matchingData = salesData.find(item =>
                            item._id.year === dateKey.year && 
                            item._id.week === dateKey.week
                        );
                        const weekStart = new Date(currentDate);
                        processedData.push({
                            date: weekStart.toISOString().split('T')[0],
                            amount: matchingData ? matchingData.amount : 0,
                            productCount: matchingData ? matchingData.productCount : 0
                        });
                        currentDate.setDate(currentDate.getDate() + 7);
                        break;

                    default: // daily
                        dateKey = {
                            year: currentDate.getFullYear(),
                            month: currentDate.getMonth() + 1,
                            day: currentDate.getDate()
                        };
                        matchingData = salesData.find(item =>
                            item._id.year === dateKey.year && 
                            item._id.month === dateKey.month &&
                            item._id.day === dateKey.day
                        );
                        processedData.push({
                            date: currentDate.toISOString().split('T')[0],
                            amount: matchingData ? matchingData.amount : 0,
                            productCount: matchingData ? matchingData.productCount : 0
                        });
                        currentDate.setDate(currentDate.getDate() + 1);
                }
            }

            salesData = processedData;

            if (req.xhr || req.headers.accept.indexOf('json') > -1) {
                return res.json({
                    totalSales,
                    totalOrders,
                    totalUsers,
                    totalProducts,
                    salesData,
                    categoryData,
                    topProducts,
                    topBrands,
                    timeFrame
                });
            }

            res.render('dashBoard', { 
                totalSales,
                totalOrders, 
                totalUsers, 
                totalProducts,
                salesData,
                categoryData,
                topProducts,
                topBrands,
                timeFrame,
                admin: true,
                activePage: 'dashboard'
            });
        } else {
            res.redirect('/admin/login');
        }
    } catch (error) {
        console.error('Error in loadDashboard:', error);
        res.status(500).send('Internal Server Error');
    }
};

const getTopCategories = async (req, res) => {
    try {
        // First get the categories with their product counts
        const categoriesWithProducts = await Category.aggregate([
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: 'category',
                    as: 'products'
                }
            },
            {
                $project: {
                    name: 1,
                    productCount: { $size: '$products' }
                }
            }
        ]);

        // Then get sales data for categories
        const categorySales = await Order.aggregate([
            { $match: { status: 'Delivered' } },
            { $unwind: '$orderedItems' },
            {
                $lookup: {
                    from: 'products',
                    localField: 'orderedItems.product',
                    foreignField: '_id',
                    as: 'productInfo'
                }
            },
            { $unwind: '$productInfo' },
            {
                $group: {
                    _id: '$productInfo.category',
                    sales: { $sum: '$orderedItems.quantity' }
                }
            }
        ]);

        // Combine the data
        const categoryMap = new Map(categorySales.map(item => [item._id.toString(), item.sales]));
        
        const topCategories = categoriesWithProducts.map(category => ({
            name: category.name,
            productCount: category.productCount,
            sales: categoryMap.get(category._id.toString()) || 0
        }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 10);

        res.json(topCategories);
    } catch (error) {
        console.error('Error getting top categories:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getTopBrands = async (req, res) => {
    try {
        const timeFrame = req.query.timeFrame || 'monthly';
        
        // Calculate date range based on timeFrame
        const endDate = new Date();
        const startDate = new Date();

        switch(timeFrame) {
            case 'yearly':
                startDate.setFullYear(startDate.getFullYear() - 5);
                break;
            case 'monthly':
                startDate.setMonth(startDate.getMonth() - 11);
                break;
            case 'weekly':
                startDate.setDate(startDate.getDate() - 90);
                break;
            default: // daily
                startDate.setDate(startDate.getDate() - 30);
        }

        // First get all brands with their product counts
        const brandsWithProducts = await Product.aggregate([
            {
                $group: {
                    _id: '$brand',
                    productCount: { $sum: 1 }
                }
            },
            {
                $project: {
                    name: '$_id',
                    productCount: 1,
                    _id: 0
                }
            }
        ]);

        // Then get sales data for brands within the time period
        const brandSales = await Order.aggregate([
            { 
                $match: { 
                    status: 'Delivered',
                    createdAt: { $gte: startDate, $lte: endDate }
                } 
            },
            { $unwind: '$orderedItems' },
            {
                $lookup: {
                    from: 'products',
                    localField: 'orderedItems.product',
                    foreignField: '_id',
                    as: 'productInfo'
                }
            },
            { $unwind: '$productInfo' },
            {
                $group: {
                    _id: '$productInfo.brand',
                    sales: { $sum: '$orderedItems.quantity' }
                }
            }
        ]);

        // Create a map of brand sales
        const brandSalesMap = new Map(brandSales.map(item => [item._id, item.sales]));

        // Combine and format the data
        const topBrands = brandsWithProducts
            .map(brand => ({
                name: brand.name,
                productCount: brand.productCount,
                sales: brandSalesMap.get(brand.name) || 0
            }))
            .sort((a, b) => b.sales - a.sales)
            .slice(0, 10);

        res.json(topBrands);
    } catch (error) {
        console.error('Error getting top brands:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getLedgerData = async (req, res) => {
    try {
        const orders = await Order.find({ status: 'Delivered' })
            .sort({ orderDate: -1 })
            .limit(10)
            .lean();

        const ledgerData = orders.map(order => {
            let formattedDate;
            try {
                formattedDate = order.orderDate ? 
                    new Date(order.orderDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    }) : 
                    new Date().toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    });
            } catch (err) {
                console.error('Error formatting date:', err);
                formattedDate = new Date().toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            }

            return {
                date: formattedDate,
                transactionId: order._id.toString(),
                description: 'Order Payment',
                debit: '0.00',
                credit: (order.totalPrice || 0).toFixed(2),
                balance: (order.totalPrice || 0).toFixed(2)
            };
        });

        res.json(ledgerData);
    } catch (error) {
        console.error('Error getting ledger data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getSalesData = async (req, res) => {
    try {
        const { timeFrame } = req.query;
        const currentDate = new Date();
        let startDate;
        let groupBy;
        let dateFormat;

        switch (timeFrame) {
            case 'yearly':
                startDate = new Date(currentDate.getFullYear() - 1, currentDate.getMonth());
                groupBy = {
                    year: { $year: '$orderDate' },
                    month: { $month: '$orderDate' }
                };
                dateFormat = '%Y-%m';
                break;
            case 'monthly':
                startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1);
                groupBy = {
                    year: { $year: '$orderDate' },
                    month: { $month: '$orderDate' },
                    day: { $dayOfMonth: '$orderDate' }
                };
                dateFormat = '%Y-%m-%d';
                break;
            case 'weekly':
                startDate = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);
                groupBy = {
                    year: { $year: '$orderDate' },
                    month: { $month: '$orderDate' },
                    day: { $dayOfMonth: '$orderDate' }
                };
                dateFormat = '%Y-%m-%d';
                break;
            case 'daily':
                startDate = new Date(currentDate.getTime() - 24 * 60 * 60 * 1000);
                groupBy = {
                    year: { $year: '$orderDate' },
                    month: { $month: '$orderDate' },
                    day: { $dayOfMonth: '$orderDate' },
                    hour: { $hour: '$orderDate' }
                };
                dateFormat = '%Y-%m-%d %H:00';
                break;
            default:
                startDate = new Date(currentDate.getFullYear() - 1, currentDate.getMonth());
                groupBy = {
                    year: { $year: '$orderDate' },
                    month: { $month: '$orderDate' }
                };
                dateFormat = '%Y-%m';
        }

        const salesData = await Order.aggregate([
            {
                $match: {
                    orderDate: { $gte: startDate },
                    status: 'Delivered'
                }
            },
            {
                $group: {
                    _id: groupBy,
                    totalSales: { $sum: '$totalPrice' },
                    orderCount: { $sum: 1 }
                }
            },
            {
                $sort: {
                    "_id.year": 1,
                    "_id.month": 1,
                    "_id.day": 1,
                    "_id.hour": 1
                }
            },
            {
                $project: {
                    _id: 0,
                    date: {
                        $dateToString: {
                            format: dateFormat,
                            date: {
                                $dateFromParts: {
                                    year: "$_id.year",
                                    month: "$_id.month",
                                    day: { $ifNull: ["$_id.day", 1] },
                                    hour: { $ifNull: ["$_id.hour", 0] }
                                }
                            }
                        }
                    },
                    totalSales: 1,
                    orderCount: 1
                }
            }
        ]);

        // If no data, return empty array with current timeframe
        if (salesData.length === 0) {
            const emptyData = [];
            switch (timeFrame) {
                case 'yearly':
                    for (let i = 0; i < 12; i++) {
                        const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - 11 + i);
                        emptyData.push({
                            date: date.toISOString().slice(0, 7),
                            totalSales: 0,
                            orderCount: 0
                        });
                    }
                    break;
                case 'monthly':
                    for (let i = 0; i < 30; i++) {
                        const date = new Date(currentDate.getTime() - (29 - i) * 24 * 60 * 60 * 1000);
                        emptyData.push({
                            date: date.toISOString().slice(0, 10),
                            totalSales: 0,
                            orderCount: 0
                        });
                    }
                    break;
                case 'weekly':
                    for (let i = 0; i < 7; i++) {
                        const date = new Date(currentDate.getTime() - (6 - i) * 24 * 60 * 60 * 1000);
                        emptyData.push({
                            date: date.toISOString().slice(0, 10),
                            totalSales: 0,
                            orderCount: 0
                        });
                    }
                    break;
                case 'daily':
                    for (let i = 0; i < 24; i++) {
                        const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate(), i);
                        emptyData.push({
                            date: `${date.toISOString().slice(0, 10)} ${String(i).padStart(2, '0')}:00`,
                            totalSales: 0,
                            orderCount: 0
                        });
                    }
                    break;
            }
            return res.json(emptyData);
        }

        res.json(salesData);
    } catch (error) {
        console.error('Error getting sales data:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getCategoryDistribution = async (req, res) => {
    try {
        const categoryData = await Product.aggregate([
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 }
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'categoryInfo'
                }
            },
            { $unwind: '$categoryInfo' },
            {
                $project: {
                    categoryName: '$categoryInfo.name',
                    count: 1
                }
            }
        ]);

        res.json(categoryData);
    } catch (error) {
        console.error('Error getting category distribution:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getTopProducts = async (req, res) => {
    try {
        const timeFrame = req.query.timeFrame || 'monthly';
        
        // Calculate date range based on timeFrame
        const endDate = new Date();
        const startDate = new Date();

        switch(timeFrame) {
            case 'yearly':
                startDate.setFullYear(startDate.getFullYear() - 5);
                break;
            case 'monthly':
                startDate.setMonth(startDate.getMonth() - 11); // Last 12 months
                break;
            case 'weekly':
                startDate.setDate(startDate.getDate() - 90); // Last 90 days for weeks
                break;
            default: // daily
                startDate.setDate(startDate.getDate() - 30); // Last 30 days
        }

        const topProducts = await Order.aggregate([
            { 
                $match: { 
                    status: 'Delivered',
                    createdAt: { $gte: startDate, $lte: endDate }
                } 
            },
            { $unwind: '$orderedItems' },
            {
                $group: {
                    _id: '$orderedItems.product',
                    name: { $first: '$orderedItems.productName' },
                    revenue: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                    sales: { $sum: '$orderedItems.quantity' }
                }
            },
            { $sort: { sales: -1 } },
            { $limit: 10 }
        ]);

        res.json(topProducts);
    } catch (error) {
        console.error('Error getting top products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getDashboardData = async (req, res) => {
    try {
        const timeFrame = req.query.timeFrame || 'monthly';
        console.log('API - Selected timeFrame:', timeFrame);

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();

        switch(timeFrame) {
            case 'yearly':
                startDate.setFullYear(startDate.getFullYear() - 5);
                break;
            case 'monthly':
                startDate.setMonth(startDate.getMonth() - 11);
                break;
            case 'weekly':
                startDate.setDate(startDate.getDate() - 90);
                break;
            default: // daily
                startDate.setDate(startDate.getDate() - 30);
        }

        // Get total stats
        let totalSales = await Order.aggregate([
            { $match: { status: 'Delivered' } },
            { $group: { _id: null, totalSales: { $sum: '$totalPrice' } } }
        ]);
        
        totalSales = totalSales.length > 0 ? totalSales[0].totalSales : 0;
        const totalUsers = await User.find().countDocuments();
        const totalOrders = await Order.find().countDocuments();
        const totalProducts = await Product.find().countDocuments();

        // Get top 10 products by sales quantity
        const topProducts = await Order.aggregate([
            { $match: { status: 'Delivered', createdAt: { $gte: startDate, $lte: endDate } } },
            { $unwind: '$orderedItems' },
            { $group: {
                _id: '$orderedItems.product',
                totalQuantity: { $sum: '$orderedItems.quantity' }
            }},
            { $lookup: {
                from: 'products',
                localField: '_id',
                foreignField: '_id',
                as: 'productDetails'
            }},
            { $unwind: '$productDetails' },
            { $project: {
                name: '$productDetails.name',
                totalQuantity: 1
            }},
            { $sort: { totalQuantity: -1 } },
            { $limit: 10 }
        ]);

        // Get top 10 brands by sales amount
        const topBrands = await Order.aggregate([
            { $match: { status: 'Delivered', createdAt: { $gte: startDate, $lte: endDate } } },
            { $unwind: '$orderedItems' },
            { $lookup: {
                from: 'products',
                localField: 'orderedItems.product',
                foreignField: '_id',
                as: 'product'
            }},
            { $unwind: '$product' },
            { $group: {
                _id: '$product.brand',
                totalSales: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } }
            }},
            { $sort: { totalSales: -1 } },
            { $limit: 10 },
            { $project: {
                name: '$_id',
                totalSales: 1,
                _id: 0
            }}
        ]);

        // Get category data with product counts and sales
        const categoryData = await Category.aggregate([
            {
                $lookup: {
                    from: 'products',
                    localField: '_id',
                    foreignField: 'category',
                    as: 'products'
                }
            },
            { $unwind: { path: '$products', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'orders',
                    let: { productId: '$products._id' },
                    pipeline: [
                        {
                            $match: {
                                status: 'Delivered'
                            }
                        },
                        { $unwind: '$orderedItems' },
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$orderedItems.product', '$$productId']
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalSales: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                                totalQuantity: { $sum: '$orderedItems.quantity' }
                            }
                        }
                    ],
                    as: 'orderStats'
                }
            },
            {
                $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    count: { $sum: 1 },
                    totalSales: {
                        $sum: {
                            $cond: [
                                { $gt: [{ $size: '$orderStats' }, 0] },
                                { $arrayElemAt: ['$orderStats.totalSales', 0] },
                                0
                            ]
                        }
                    },
                    totalQuantity: {
                        $sum: {
                            $cond: [
                                { $gt: [{ $size: '$orderStats' }, 0] },
                                { $arrayElemAt: ['$orderStats.totalQuantity', 0] },
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { totalSales: -1 } }
        ]);

        // Get sales data
        let salesData = await Order.aggregate([
            {
                $match: {
                    status: 'Delivered',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            { $unwind: '$orderedItems' },
            {
                $group: {
                    _id: {
                        $switch: {
                            branches: [
                                {
                                    case: { $eq: [timeFrame, 'yearly'] },
                                    then: { $year: '$createdAt' }
                                },
                                {
                                    case: { $eq: [timeFrame, 'monthly'] },
                                    then: {
                                        year: { $year: '$createdAt' },
                                        month: { $month: '$createdAt' }
                                    }
                                },
                                {
                                    case: { $eq: [timeFrame, 'weekly'] },
                                    then: {
                                        year: { $year: '$createdAt' },
                                        week: { $week: '$createdAt' }
                                    }
                                }
                            ],
                            default: {
                                year: { $year: '$createdAt' },
                                month: { $month: '$createdAt' },
                                day: { $dayOfMonth: '$createdAt' }
                            }
                        }
                    },
                    amount: { $sum: { $multiply: ['$orderedItems.quantity', '$orderedItems.price'] } },
                    productCount: { $sum: '$orderedItems.quantity' }
                }
            },
            { $sort: { '_id': 1 } }
        ]);

        // Process and fill missing dates
        const processedData = [];
        let currentDate = new Date(startDate);

        while (currentDate <= endDate) {
            let matchingData;
            let dateKey;

            switch (timeFrame) {
                case 'yearly':
                    dateKey = currentDate.getFullYear();
                    matchingData = salesData.find(item => item._id === dateKey);
                    processedData.push({
                        date: `${dateKey}-01-01`,
                        amount: matchingData ? matchingData.amount : 0,
                        productCount: matchingData ? matchingData.productCount : 0
                    });
                    currentDate.setFullYear(currentDate.getFullYear() + 1);
                    break;

                case 'monthly':
                    dateKey = {
                        year: currentDate.getFullYear(),
                        month: currentDate.getMonth() + 1
                    };
                    matchingData = salesData.find(item =>
                        item._id.year === dateKey.year && 
                        item._id.month === dateKey.month
                    );
                    processedData.push({
                        date: `${dateKey.year}-${String(dateKey.month).padStart(2, '0')}-01`,
                        amount: matchingData ? matchingData.amount : 0,
                        productCount: matchingData ? matchingData.productCount : 0
                    });
                    currentDate.setMonth(currentDate.getMonth() + 1);
                    break;

                case 'weekly':
                    const weekNumber = getWeekNumber(currentDate);
                    dateKey = {
                        year: currentDate.getFullYear(),
                        week: weekNumber
                    };
                    matchingData = salesData.find(item =>
                        item._id.year === dateKey.year && 
                        item._id.week === dateKey.week
                    );
                    // Get the first day of the week
                    const weekStart = new Date(currentDate);
                    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                    processedData.push({
                        date: weekStart.toISOString().split('T')[0],
                        amount: matchingData ? matchingData.amount : 0,
                        productCount: matchingData ? matchingData.productCount : 0
                    });
                    currentDate.setDate(currentDate.getDate() + 7);
                    break;

                default: // daily
                    dateKey = {
                        year: currentDate.getFullYear(),
                        month: currentDate.getMonth() + 1,
                        day: currentDate.getDate()
                    };
                    matchingData = salesData.find(item =>
                        item._id.year === dateKey.year && 
                        item._id.month === dateKey.month && 
                        item._id.day === dateKey.day
                    );
                    processedData.push({
                        date: currentDate.toISOString().split('T')[0],
                        amount: matchingData ? matchingData.amount : 0,
                        productCount: matchingData ? matchingData.productCount : 0
                    });
                    currentDate.setDate(currentDate.getDate() + 1);
            }
        }

        salesData = processedData;

        console.log('API - Sending dashboard data');
        console.log('API - Top Products:', topProducts);
        console.log('API - Top Brands:', topBrands);

        // Return JSON response for API calls
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            return res.json({
                totalSales,
                totalOrders,
                totalUsers,
                totalProducts,
                salesData,
                categoryData,
                topProducts,
                topBrands,
                timeFrame
            });
        }

        res.json({
            totalSales,
            totalOrders,
            totalUsers,
            totalProducts,
            salesData,
            categoryData,
            topProducts,
            topBrands,
            timeFrame
        });
    } catch (error) {
        console.error('Error in getDashboardData:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    loadDashboard,
    getSalesData,
    getCategoryDistribution,
    getTopProducts,
    getTopCategories,
    getTopBrands,
    getLedgerData,
    getDashboardData
};