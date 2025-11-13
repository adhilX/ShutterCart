const Order = require('../../models/orderSchema');  
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

 const getSalesReports = async (req, res) => {
    try {
        const { period = 'all', status, startDate, endDate, page = 1 } = req.query;
        const limit = 10;  
        const skip = (page - 1) * limit;

         let query = {};
        
         if (status && status !== 'all') {
            query.status = status;
        }

         const dateFilter = getDateFilter(period, startDate, endDate);
        if (Object.keys(dateFilter).length > 0) {
            query = { ...query, ...dateFilter };
        }

        console.log('Query:', query);

         const totalOrders = await Order.countDocuments(query);
        const totalPages = Math.ceil(totalOrders / limit);

         const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('userId')
            .populate({
                path: 'orderedItems.product',
                select: 'productName regularPrice salePrice'
            });

         const allOrders = await Order.find(query);
        const totals = calculateTotals(allOrders);
        
         const paymentStats = allOrders.reduce((acc, order) => {
            const method = order.paymentMethod;
            acc[method] = (acc[method] || 0) + 1;
            return acc;
        }, {});

         
         res.render('salesReports', {
            orders,
            totals,
            paymentStats,
            period: period || 'all',
            status: status || 'all',
            startDate: startDate || '',
            endDate: endDate || '',
            title: 'Sales Reports',
            activePage: 'dashboard',
            pagination: {
                page: parseInt(page),
                totalPages,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
                nextPage: parseInt(page) + 1,
                prevPage: parseInt(page) - 1,
                totalOrders,
            }
        });
    } catch (error) {
        console.error('Error in getSalesReports:', error);
        res.status(500).send('Error generating sales report');
    }
};

const getDateFilter = (period, startDate, endDate) => {
     if (!period || period === 'all') {
        return {};
    }

    const now = new Date();
    let dateFilter = {};

    switch (period) {
        case 'daily':
            const today = new Date(now);
            today.setHours(0, 0, 0, 0);
            dateFilter = {
                createdAt: {
                    $gte: today,
                    $lte: new Date(now)
                }
            };
            break;
        case 'weekly':
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            dateFilter = { createdAt: { $gte: weekAgo } };
            break;
        case 'monthly':
            const monthAgo = new Date(now);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            dateFilter = { createdAt: { $gte: monthAgo } };
            break;
        case 'yearly':
            const yearAgo = new Date(now);
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            dateFilter = { createdAt: { $gte: yearAgo } };
            break;
        case 'custom':
            if (startDate && endDate) {
                const endDateTime = new Date(endDate);
                endDateTime.setHours(23, 59, 59, 999);
                dateFilter = {
                    createdAt: {
                        $gte: new Date(startDate),
                        $lte: endDateTime
                    }
                };
            }
            break;
    }
    return dateFilter;
};

//calculate total orders.........................................

function calculateTotals(orders) {
    const totals = {
        count: orders.length,
        totalPrice: 0,
        discount: {
            bestOffer: 0,
            coupon: 0,
            total: 0
        },
        finalAmount: 0,
        pendingPaymentCount: 0,
        placedCount: 0,
        rejectedCount: 0,
        deliveredCount: 0,
        cancelledCount: 0,
        returnRequestCount: 0,
        returnedCount: 0
    };

    orders.forEach(order => {
        // Calculate financial totals
        totals.totalPrice += order.totalPrice || 0;
        
        // Handle discount object structure
        if (order.discount) {
            totals.discount.bestOffer += order.discount.bestOffer || 0;
            totals.discount.coupon += order.discount.coupon || 0;
            totals.discount.total += order.discount.total || 0;
        }
        
        totals.finalAmount += order.finalAmount || 0;

        // Count orders by status
        switch (order.status) {
            case 'Pending Payment':
                totals.pendingPaymentCount++;
                break;
            case 'Placed':
                totals.placedCount++;
                break;
            case 'Rejected':
                totals.rejectedCount++;
                break;
            case 'Delivered':
                totals.deliveredCount++;
                break;
            case 'Cancelled':
                totals.cancelledCount++;
                break;
            case 'Return Request':
                totals.returnRequestCount++;
                break;
            case 'Returned':
                totals.returnedCount++;
                break;
        }
    });

    return totals;
}

const downloadReport = async (req, res) => {
    try {
        const { format } = req.params;
        const { period, status, startDate, endDate } = req.query;

        // Build query filters
        let query = {};
        if (status && status !== 'all') {
            query.status = status;
        }
        const dateFilter = getDateFilter(period, startDate, endDate);
        if (Object.keys(dateFilter).length > 0) {
            query = { ...query, ...dateFilter };
        }

        // Fetch orders with populated data
        const orders = await Order.find(query)
            .sort({ createdAt: -1 })
            .populate('userId')
            .populate({
                path: 'orderedItems.product',
                select: 'productName regularPrice salePrice'
            });

        const totals = calculateTotals(orders);

        if (format === 'excel') {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Sales Report');

            // Add title and date range
            worksheet.mergeCells('A1:J1');
            const titleCell = worksheet.getCell('A1');
            titleCell.value = 'Sales Report';
            titleCell.font = { size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center' };

            // Add date range if applicable
            worksheet.mergeCells('A2:J2');
            const dateRangeCell = worksheet.getCell('A2');
            let dateRangeText = 'Period: ';
            if (period === 'custom' && startDate && endDate) {
                dateRangeText += `${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`;
            } else {
                dateRangeText += period || 'All Time';
            }
            dateRangeCell.value = dateRangeText;
            dateRangeCell.alignment = { horizontal: 'center' };

            // Add summary section
            worksheet.mergeCells('A4:E4');
            worksheet.getCell('A4').value = 'Summary';
            worksheet.getCell('A4').font = { bold: true };

            worksheet.getCell('A5').value = 'Total Orders';
            worksheet.getCell('B5').value = totals.count;
            worksheet.getCell('A6').value = 'Total Sales';
            worksheet.getCell('B6').value = totals.finalAmount;
            worksheet.getCell('A7').value = 'Total Discount';
            worksheet.getCell('B7').value = totals.discount.total;

            // Add status summary
            worksheet.mergeCells('G4:J4');
            worksheet.getCell('G4').value = 'Order Status Summary';
            worksheet.getCell('G4').font = { bold: true };

            worksheet.getCell('G5').value = 'Pending Payment';
            worksheet.getCell('H5').value = totals.pendingPaymentCount;
            worksheet.getCell('G6').value = 'Placed';
            worksheet.getCell('H6').value = totals.placedCount;
            worksheet.getCell('G7').value = 'Delivered';
            worksheet.getCell('H7').value = totals.deliveredCount;
            worksheet.getCell('G8').value = 'Cancelled';
            worksheet.getCell('H8').value = totals.cancelledCount;
            worksheet.getCell('G9').value = 'Return Request';
            worksheet.getCell('H9').value = totals.returnRequestCount;
            worksheet.getCell('G10').value = 'Returned';
            worksheet.getCell('H10').value = totals.returnedCount;

            // Add order details header
            const headers = [
                'Order ID',
                'Date',
                'Customer',
                'Products',
                'Payment Method',
                'Payment Status',
                'Order Status',
                'Original Price',
                'Discount',
                'Final Amount'
            ];
            
            const headerRow = worksheet.addRow(headers);
            headerRow.font = { bold: true };
            headerRow.eachCell((cell) => {
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE0E0E0' }
                };
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });

            // Add order details
            orders.forEach(order => {
                const products = order.orderedItems.map(item => 
                    `${item.product.productName} (${item.quantity})`
                ).join(', ');

                worksheet.addRow([
                    order.orderId,
                    new Date(order.createdAt).toLocaleDateString(),
                    order.userId?order.userId.name : 'N/A',
                    products,
                    order.paymentMethod,
                    order.paymentStatus,
                    order.status,
                    order.totalPrice,
                    order.discount ? order.discount.total : 0,
                    order.finalAmount
                ]);
            });

            // Format columns
            worksheet.columns.forEach(column => {
                column.width = 15;
                column.alignment = { wrapText: true, vertical: 'middle' };
            });
            worksheet.getColumn(4).width = 30; // Products column wider

            // Add totals row
            const totalRow = worksheet.addRow([
                'Total',
                '',
                '',
                '',
                '',
                '',
                '',
                totals.totalPrice,
                totals.discount.total,
                totals.finalAmount
            ]);
            totalRow.font = { bold: true };

            // Set response headers
            res.setHeader(
                'Content-Type',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
                'Content-Disposition',
                'attachment; filename=sales-report.xlsx'
            );

            // Send the workbook
            await workbook.xlsx.write(res);
            res.end();
        } else if (format === 'pdf') {
            // Generate PDF
            const doc = new PDFDocument({
                margin: 50,
                size: 'A4'
            });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename=sales_report.pdf');

            doc.pipe(res);

            // Define colors and styles
            const colors = {
                primary: '#3b82f6',    // Bright Blue
                secondary: '#64748b',   // Slate Gray
                accent: '#06b6d4',      // Cyan
                success: '#10b981',     // Emerald
                warning: '#f59e0b',     // Amber
                text: '#334155',        // Slate
                lightGray: '#f1f5f9',   // Slate 100
                white: '#ffffff'
            };

            // Header Section with improved styling
            doc.fontSize(28)
               .fillColor(colors.primary)
               .text('Sales Report', { align: 'center' });
            
            doc.moveDown(0.5);
            doc.fontSize(10)
               .fillColor(colors.secondary)
               .text(`Generated on: ${new Date().toLocaleString()}`, { align: 'right' });

            // Decorative line
            doc.moveTo(50, doc.y + 10)
               .lineTo(545, doc.y + 10)
               .strokeColor(colors.accent)
               .strokeOpacity(0.5)
               .stroke();

            // Report Period with improved styling
            doc.moveDown();
            doc.fontSize(16)
               .fillColor(colors.accent)
               .text('Report Details');
            
            doc.fontSize(10)
               .fillColor(colors.text)
               .text(`Period: ${period.charAt(0).toUpperCase() + period.slice(1)}`);
            
            if (period === 'custom') {
                doc.text(`Date Range: ${new Date(startDate).toLocaleDateString()} to ${new Date(endDate).toLocaleDateString()}`);
            }
            if (status && status !== 'all') {
                doc.text(`Status Filter: ${status}`);
            }

            // Summary Section with modern card design
            doc.moveDown(2);
            doc.fontSize(16)
               .fillColor(colors.accent)
               .text('Summary');

            // Calculate summary data
            const totalAmount = orders.reduce((sum, order) => sum + order.totalPrice, 0);
            const totalDiscount = orders.reduce((sum, order) => sum + (order.discount ? order.discount.total : 0), 0);
            const totalFinalAmount = orders.reduce((sum, order) => sum + order.finalAmount, 0);
            
            // Draw summary cards
            const summaryBoxes = [
                { label: 'Total Orders', value: orders.length.toString(), color: colors.primary },
                { label: 'Total Amount', value: `₹${totalAmount.toFixed(2)}`, color: colors.success },
                { label: 'Total Discount', value: `₹${totalDiscount.toFixed(2)}`, color: colors.warning },
                { label: 'Net Amount', value: `₹${totalFinalAmount.toFixed(2)}`, color: colors.accent }
            ];

            const boxWidth = 240;
            const boxHeight = 50;
            let currentX = 50;
            let currentY = doc.y + 20;

            summaryBoxes.forEach((box, index) => {
                if (index % 2 === 0 && index !== 0) {
                    currentY += boxHeight + 10;
                    currentX = 50;
                }

                // Draw card with shadow effect
                doc.rect(currentX + 2, currentY + 2, boxWidth, boxHeight)
                   .fill('#00000010');  // Shadow
                doc.rect(currentX, currentY, boxWidth, boxHeight)
                   .fillAndStroke(colors.white, box.color);

                // Add text
                doc.fontSize(10)
                   .fillColor(colors.secondary)
                   .text(box.label, currentX + 15, currentY + 10);
                doc.fontSize(14)
                   .fillColor(box.color)
                   .text(box.value, currentX + 15, currentY + 25);

                currentX += boxWidth + 20;
            });

            // Status Distribution with pie chart-like presentation
            doc.moveDown(6);
            doc.fontSize(16)
               .fillColor(colors.accent)
               .text('Order Status Distribution');

            const statusCounts = orders.reduce((acc, order) => {
                acc[order.status] = (acc[order.status] || 0) + 1;
                return acc;
            }, {});

            let statusY = doc.y + 10;
            Object.entries(statusCounts).forEach(([status, count], index) => {
                const percentage = ((count/orders.length)*100).toFixed(1);
                const statusColor = {
                    'Pending': colors.warning,
                    'Delivered': colors.success,
                    'Cancelled': colors.secondary,
                    'Processing': colors.primary
                }[status] || colors.text;

                // Status indicator
                doc.rect(60, statusY, 12, 12)
                   .fill(statusColor);
                doc.fontSize(10)
                   .fillColor(colors.text)
                   .text(`${status}: ${count} orders (${percentage}%)`, 80, statusY);
                statusY += 20;
            });

            // Orders Table with improved design
            doc.moveDown(2);
            doc.fontSize(16)
               .fillColor(colors.accent)
               .text('Order Details');
            doc.moveDown();

            // Table headers with adjusted widths
            const headers = [
                { label: 'Order ID', width: 90, align: 'left' },
                { label: 'Date', width: 90, align: 'left' },
                { label: 'Customer', width: 100, align: 'left' },
                { label: 'Payment', width: 70, align: 'left' },
                { label: 'Status', width: 80, align: 'left' },
                { label: 'Amount', width: 90, align: 'right' }  // Increased width for amounts
            ];

            const tableWidth = headers.reduce((sum, h) => sum + h.width, 0);
            let startX = 50;
            let startY = doc.y;

            // Draw header background
            doc.rect(startX, startY, tableWidth, 20)
               .fill(colors.primary);

            // Draw header text
            headers.forEach(header => {
                doc.fontSize(10)
                   .fillColor(colors.white)
                   .text(header.label, startX + 5, startY + 5, {
                       width: header.width - 10,
                       align: header.align
                   });
                startX += header.width;
            });

            // Draw rows with improved alignment
            startY += 25;
            orders.forEach((order, index) => {
                // Add new page if needed
                if (startY > doc.page.height - 100) {
                    doc.addPage();
                    startY = 50;
                    
                    // Redraw header on new page
                    startX = 50;
                    doc.rect(startX, startY, tableWidth, 20)
                       .fill(colors.primary);
                    headers.forEach(header => {
                        doc.fontSize(10)
                           .fillColor(colors.white)
                           .text(header.label, startX + 5, startY + 5, {
                               width: header.width - 10,
                               align: header.align
                           });
                        startX += header.width;
                    });
                    startY += 25;
                }

                // Alternate row background
                if (index % 2 === 0) {
                    doc.rect(50, startY - 5, tableWidth, 25)
                       .fill(colors.lightGray);
                }

                startX = 50;
                doc.fontSize(9)
                   .fillColor(colors.text);

                // Draw each cell with proper alignment
                headers.forEach((header, colIndex) => {
                    let value = '';
                    let align = header.align;

                    switch(colIndex) {
                        case 0: // Order ID
                            value = order.orderId;
                            break;
                        case 1: // Date
                            value = new Date(order.createdAt).toLocaleDateString();
                            break;
                        case 2: // Customer
                            value = order.userId?.name || 'N/A';
                            break;
                        case 3: // Payment
                            value = order.paymentMethod || 'N/A';
                            break;
                        case 4: // Status
                            value = order.status;
                            break;
                        case 5: // Amount
                            value = `₹${order.finalAmount.toFixed(2)}`;
                            break;
                    }

                    doc.text(value, startX + 5, startY, {
                        width: header.width - 10,
                        align: align
                    });
                    startX += header.width;
                });

                startY += 20;
            });

            // Footer with improved design
            doc.rect(50, doc.page.height - 40, 495, 0.5)
               .stroke(colors.lightGray);

            doc.fontSize(8)
               .fillColor(colors.secondary)
               .text(
                   `Report generated on ${new Date().toLocaleString()} • Page ${doc.bufferedPageRange().count}`,
                   50,
                   doc.page.height - 30,
                   { align: 'center' }
               );

            doc.end();
        } else {
            res.status(400).send('Invalid format requested.');
        }
    } catch (error) {
        console.error(error);
        res.status(500).send('Error generating the sales report.');
    }
};

module.exports = {
    getSalesReports,
    downloadReport,
    getDateFilter
};
