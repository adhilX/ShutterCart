const User = require("../../models/userSchema")

const customerInfo = async (req,res)=>{
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 7
        
      
            const userData = await User.find({
                isAdmin: false,
                $or: [
                    { name: { $regex:  new RegExp(".*" + search + ".*", "i") } },
                    { email: { $regex: new RegExp(".*" + search + ".*", "i") } },
                ]
            })
            .limit(limit)
            .skip((page - 1) * limit)
            .exec();
        
            const count = await User.find({
                isAdmin: false,
                $or: [
                    { name: { $regex: new RegExp(".*" + search + ".*", "i") } },
                    { email: { $regex: new RegExp(".*" + search + ".*", "i") } },
                ]
            }).countDocuments();
        
            const totalPage = Math.ceil(count / limit);
        
            res.render('customers', {
                data: userData,
                total: count,
                currentPage: page,
                totalPage,
                search, // Pass the search query back to the template
                activePage: 'customers'
            });
        } catch (error) {
            console.error('Error in search and pagination:', error);
            res.redirect('/pageerror');
        }
    }
    
 const BlockCustomer = async (req,res)=>{
    try {
        const id = req.query.id;
        await User.updateOne({_id:id},{$set:{isBlocked:true}});
        res.redirect(`/admin/users?page=${req.query.page}&search=${req.query.search}`)
    } catch (error) {
        console.error('Error:', error);
        res.redirect('/pageerror');
    }
    
 }

 const unBlockCustomer = async (req,res)=>{
    try {
        const id = req.query.id;
        await User.updateOne({_id:id},{$set:{isBlocked: false}});
        res.redirect(`/admin/users?page=${req.query.page}&search=${req.query.search}`)
    } catch (error) {
        console.error('Error:', error);
        res.redirect('/pageerror');
    }
    
 }

module.exports ={
    customerInfo,
    BlockCustomer,
    unBlockCustomer,
}