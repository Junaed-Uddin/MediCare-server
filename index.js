const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.t0pnxex.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function dbConnect() {
    try {
        await client.connect();
        console.log('database connected')

    } catch (error) {
        console.log(error.name, error.message);
    }
}

dbConnect();

// db and collections 
const Appointment = client.db("medicareDB").collection("appointmentOptions");
const Booking = client.db("medicareDB").collection("Booking");
const Users = client.db("medicareDB").collection("Users");
const Doctors = client.db("medicareDB").collection("Doctors");
const Payments = client.db("medicareDB").collection("Payments");

app.get('/appointments', async (req, res) => {
    try {
        const query = {};
        const date = req.query.date;
        const bookingQuery = { appointmentDate: date };

        const alreadyBooked = await Booking.find(bookingQuery).toArray();
        const appointments = await Appointment.find(query).toArray();

        appointments.forEach(appointment => {
            const bookedAppointments = alreadyBooked.filter(booked => booked.treatmentName === appointment.name);

            const slotBooked = bookedAppointments.map(bookApp => bookApp.slot);
            const remainingSlots = appointment.slots.filter(slot => !slotBooked.includes(slot));

            appointment.slots = remainingSlots;
        })
        res.send({
            success: true,
            data: appointments
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
})

app.get('/appointmentSpecialty', async (req, res) => {
    try {
        const query = {};
        const appointmentSpecialty = await Appointment.find(query).project({ name: 1 }).toArray();
        res.send({
            success: true,
            data: appointmentSpecialty
        })
    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }

})

app.post('/booking', async (req, res) => {
    try {
        const booking = req.body;
        const query = {
            appointmentDate: booking.appointmentDate,
            email: booking.email,
            treatmentName: booking.treatmentName
        }

        const alreadyBooked = await Booking.find(query).toArray();
        if (alreadyBooked.length) {
            return res.send({
                success: false,
                message: `You have already appointment on ${booking.appointmentDate}`
            })
        }

        const bookingData = await Booking.insertOne(booking);
        if (bookingData.insertedId) {
            res.send({
                success: true,
                message: 'Appointment successfully confirmed'
            });
        }
        else {
            res.send({
                success: false,
                message: 'Appointment would not completed'
            })
        }

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.get('/booking/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const query = { _id: ObjectId(id) };
        const userPayment = await Booking.findOne(query);
        res.send({
            success: true,
            data: userPayment
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
})

// payment 
app.post('/create-payment-intent', async (req, res) => {
    const booking = req.body;
    const price = booking.price;
    const amount = price * 100;

    const paymentIntent = await stripe.paymentIntents.create({
        "currency": "usd",
        amount: amount,
        "payment_method_types": [
            "card"
        ],
    });

    res.send({
        clientSecret: paymentIntent.client_secret,
    });
})

app.post('/payments', async (req, res) => {
    try {
        const payment = req.body;
        const paymentInfo = await Payments.insertOne(payment);
        const id = payment.bookingId;
        const filter = { _id: ObjectId(id) };

        const updatedDoc = {
            $set: {
                paid: true,
                transactionId: payment.transactionId
            }
        }

        const resultUpdated = await Booking.updateOne(filter, updatedDoc);

        if (paymentInfo.insertedId) {
            res.send({
                success: true,
                message: `Payment Successfully completed`
            })
        }
        else {
            res.send({
                success: false,
                message: `Something went wrong, Please try again`
            })
        }
    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
})

// temporary add property in existing collections
// app.get('/addPrice', async (req, res) => {
//     const filter = {};
//     const options = { upsert: true };
//     const updatedDoc = {
//         $set: {
//             price: 99
//         }
//     }
//     const result = await Appointment.updateMany(filter, updatedDoc, options);
//     res.send(result);
// });


const verifyJWT = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }
        req.decoded = decoded;
        next();
    })
};

const verifyAdmin = async (req, res, next) => {
    console.log(req.decoded.email);
    const decodedEmail = req.decoded.email;
    const query = { email: decodedEmail };
    const users = await Users.findOne(query);

    if (users?.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden Access' });
    }
    next();
}

app.get('/booking', verifyJWT, async (req, res) => {
    try {
        const email = req.query.email;
        const decodeEmail = req.decoded.email;
        if (decodeEmail !== email) {
            return res.status(403).send({ message: 'Forbidden Access' });
        }

        const query = {
            email: email
        }

        const bookUser = await Booking.find(query).toArray();
        res.send({
            success: true,
            data: bookUser
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.get('/jwt', async (req, res) => {
    try {
        const email = req.query.email;
        const query = { email: email };
        const user = await Users.findOne(query);
        if (user) {
            const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
            return res.send({
                accessToken: token
            })
        }

        res.status(403).send({ accessToken: '' });

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});


app.get('/users', async (req, res) => {
    try {
        const query = {};
        const allUsers = await Users.find(query).toArray();
        res.send({
            success: true,
            data: allUsers
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.post('/users', async (req, res) => {
    try {
        const user = req.body;
        const email = user.email;
        const query = { email: email };
        const existUser = await Users.findOne(query);
        if (!existUser) {
            const users = await Users.insertOne(user);
            if (users.insertedId) {
                res.send({
                    success: true,
                    message: `Successfully Registered`
                })
            }
            else {
                res.send({
                    success: false,
                    message: `Something went wrong`
                })
            }
        }
        else {
            res.send({
                success: true,
                message: `Successfully Login`
            })
        }

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const query = {};
        const doctors = await Doctors.find(query).toArray();
        res.send({
            success: true,
            data: doctors
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const body = req.body;
        const doctor = await Doctors.insertOne(body);
        console.log(doctor);
        if (doctor.insertedId) {
            res.send({
                success: true,
                message: `${body.name} Successfully created`
            })
        }
        else {
            res.send({
                success: false,
                message: `Couldn't create the doctor`
            })
        }

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: ObjectId(id) }
        const result = await Doctors.deleteOne(query);
        if (result.deletedCount) {
            res.send({
                success: true
            })
        }
        else {
            res.send({
                success: false
            })
        }

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
})

app.get('/users/admin/:email', verifyJWT, async (req, res) => {
    try {
        const { email } = req.params;
        const query = { email };
        const user = await Users.findOne(query);
        res.send({
            success: true,
            isAdmin: user?.role === 'admin'
        })

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
});

app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const filter = { _id: ObjectId(id) };
        const options = { upsert: true };
        const updateDoc = {
            $set: {
                role: 'admin'
            }
        }

        const result = await Users.updateOne(filter, updateDoc, options);
        console.log(result);
        if (result.matchedCount) {
            res.send({
                success: true,
                message: 'Successfully Make Admin'
            })
        }
        else {
            res.send({
                success: false,
                message: 'Something went wrong'
            })
        }

    } catch (error) {
        res.send({
            success: false,
            message: error.message
        })
    }
})


app.get('/', async (req, res) => {
    res.send(`Medicare server is running`)
});

app.listen(port, () => {
    console.log(`server running on ${port}`);
})
