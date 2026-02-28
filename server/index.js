const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const carsFile = path.join(dataDir, 'cars.json');
const bookingsFile = path.join(dataDir, 'bookings.json');
const messagesFile = path.join(dataDir, 'messages.json');

// Initialize data files
const initFile = (filePath, initialData) => {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initialData, null, 2));
  }
};

initFile(carsFile, []);
initFile(bookingsFile, []);
initFile(messagesFile, []);

// Helper functions
const readJSON = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf-8'));
const writeJSON = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
const toReturnDateTime = (booking) => {
  if (!booking || !booking.returnDate) return null;
  const safeTime = typeof booking.returnTime === 'string' && booking.returnTime.trim()
    ? booking.returnTime.trim()
    : '23:59';
  const dateTime = new Date(`${booking.returnDate}T${safeTime}:00`);
  return Number.isNaN(dateTime.getTime()) ? null : dateTime;
};

const autoCompleteExpiredBookings = () => {
  const bookings = readJSON(bookingsFile);
  const cars = readJSON(carsFile);
  const now = new Date();
  let bookingsChanged = false;
  let carsChanged = false;

  bookings.forEach((booking) => {
    if (booking.status !== 'active') return;

    const returnAt = toReturnDateTime(booking);
    if (!returnAt) return;

    if (now >= returnAt) {
      booking.status = 'completed';
      booking.completedAt = now.toLocaleString();
      bookingsChanged = true;

      const carIndex = cars.findIndex((car) => car.id === booking.carId);
      if (carIndex !== -1) {
        cars[carIndex].quantity += 1;
        carsChanged = true;
      }
    }
  });

  if (bookingsChanged) {
    writeJSON(bookingsFile, bookings);
  }
  if (carsChanged) {
    writeJSON(carsFile, cars);
  }
};

// ROOT ENDPOINT
app.get('/', (req, res) => {
  res.json({
    message: '🚗 DL Rent Server',
    version: '1.0.0',
    endpoints: {
      cars: {
        'GET /cars': 'Get all cars',
        'POST /cars': 'Add new car',
        'PATCH /cars/:id': 'Update car',
        'DELETE /cars/:id': 'Delete car'
      },
      bookings: {
        'GET /bookings': 'Get all bookings',
        'POST /bookings': 'Create booking',
        'PATCH /bookings/:id': 'Update booking'
      },
      messages: {
        'GET /messages': 'Get all messages',
        'POST /messages': 'Send message'
      }
    }
  });
});

// CARS ENDPOINTS
app.get('/cars', (req, res) => {
  try {
    autoCompleteExpiredBookings();
    const cars = readJSON(carsFile);
    res.json(cars);
  } catch (error) {
    console.error('Error reading cars:', error);
    res.status(500).json({ error: 'Could not read cars' });
  }
});

app.post('/cars', (req, res) => {
  try {
    console.log('POST /cars received:', req.body);
    const cars = readJSON(carsFile);
    const newCar = {
      id: cars.length > 0 ? Math.max(...cars.map(c => c.id)) + 1 : 1,
      ...req.body,
      quantity: Math.max(1, req.body.quantity || 1)
    };
    cars.push(newCar);
    writeJSON(carsFile, cars);
    console.log('Car created successfully:', newCar);
    res.json(newCar);
  } catch (error) {
    console.error('Error creating car:', error);
    res.status(500).json({ error: 'Could not create car', details: error.message });
  }
});

app.patch('/cars/:id', (req, res) => {
  try {
    const cars = readJSON(carsFile);
    const carId = parseInt(req.params.id);
    const carIndex = cars.findIndex(c => c.id === carId);
    if (carIndex === -1) {
      return res.status(404).json({ error: 'Car not found' });
    }
    cars[carIndex] = { ...cars[carIndex], ...req.body };
    writeJSON(carsFile, cars);
    res.json(cars[carIndex]);
  } catch (error) {
    console.error('Error updating car:', error);
    res.status(500).json({ error: 'Could not update car' });
  }
});

app.delete('/cars/:id', (req, res) => {
  try {
    const carId = parseInt(req.params.id);
    
    // Delete car
    let cars = readJSON(carsFile);
    cars = cars.filter(c => c.id !== carId);
    writeJSON(carsFile, cars);
    
    // Delete related bookings
    let bookings = readJSON(bookingsFile);
    const relatedBookingIds = bookings.filter(b => b.carId === carId).map(b => b.id);
    bookings = bookings.filter(b => b.carId !== carId);
    writeJSON(bookingsFile, bookings);
    
    // Delete related messages
    let messages = readJSON(messagesFile);
    messages = messages.filter(m => !relatedBookingIds.includes(m.bookingId));
    writeJSON(messagesFile, messages);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting car:', error);
    res.status(500).json({ error: 'Could not delete car' });
  }
});

// BOOKINGS ENDPOINTS
app.get('/bookings', (req, res) => {
  try {
    autoCompleteExpiredBookings();
    const bookings = readJSON(bookingsFile);
    res.json(bookings);
  } catch (error) {
    console.error('Error reading bookings:', error);
    res.status(500).json({ error: 'Could not read bookings' });
  }
});

app.post('/bookings', (req, res) => {
  try {
    autoCompleteExpiredBookings();
    const bookings = readJSON(bookingsFile);
    const cars = readJSON(carsFile);
    
    const newBooking = {
      id: bookings.length > 0 ? Math.max(...bookings.map(b => b.id)) + 1 : 1,
      ...req.body,
      status: 'active',
      timestamp: new Date().toLocaleString()
    };
    
    // Decrease car quantity
    const carIndex = cars.findIndex(c => c.id === newBooking.carId);
    if (carIndex === -1) {
      return res.status(404).json({ error: 'Car not found' });
    }
    if (cars[carIndex].quantity <= 0) {
      return res.status(409).json({ error: 'Car is out of stock' });
    }

    cars[carIndex].quantity -= 1;
    writeJSON(carsFile, cars);
    
    bookings.push(newBooking);
    writeJSON(bookingsFile, bookings);
    res.json(newBooking);
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Could not create booking' });
  }
});

app.patch('/bookings/:id', (req, res) => {
  try {
    const bookings = readJSON(bookingsFile);
    const bookingId = parseInt(req.params.id);
    const bookingIndex = bookings.findIndex(b => b.id === bookingId);
    
    if (bookingIndex === -1) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    
    const oldStatus = bookings[bookingIndex].status;
    const newStatus = req.body.status;
    
    bookings[bookingIndex] = { ...bookings[bookingIndex], ...req.body };
    writeJSON(bookingsFile, bookings);
    
    // If marking as completed, restore car quantity
    if (oldStatus === 'active' && newStatus === 'completed') {
      const cars = readJSON(carsFile);
      const carIndex = cars.findIndex(c => c.id === bookings[bookingIndex].carId);
      if (carIndex !== -1) {
        cars[carIndex].quantity += 1;
        writeJSON(carsFile, cars);
      }
    }
    
    res.json(bookings[bookingIndex]);
  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ error: 'Could not update booking' });
  }
});

// MESSAGES ENDPOINTS
app.get('/messages', (req, res) => {
  try {
    const messages = readJSON(messagesFile);
    res.json(messages);
  } catch (error) {
    console.error('Error reading messages:', error);
    res.status(500).json({ error: 'Could not read messages' });
  }
});

app.post('/messages', (req, res) => {
  try {
    const messages = readJSON(messagesFile);
    const newMessage = {
      id: messages.length > 0 ? Math.max(...messages.map(m => m.id)) + 1 : 1,
      ...req.body,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      read: false
    };
    messages.push(newMessage);
    writeJSON(messagesFile, messages);
    res.json(newMessage);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Could not create message' });
  }
});

app.patch('/messages/:id', (req, res) => {
  try {
    const messages = readJSON(messagesFile);
    const messageId = parseInt(req.params.id, 10);
    const messageIndex = messages.findIndex((m) => m.id === messageId);

    if (messageIndex === -1) {
      return res.status(404).json({ error: 'Message not found' });
    }

    messages[messageIndex] = { ...messages[messageIndex], ...req.body };
    writeJSON(messagesFile, messages);
    res.json(messages[messageIndex]);
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Could not update message' });
  }
});

app.listen(PORT, () => {
  autoCompleteExpiredBookings();
  setInterval(autoCompleteExpiredBookings, 60 * 1000);
  console.log(`DL Rent server running on http://localhost:${PORT}`);
  console.log('Endpoints: /cars, /bookings, /messages');
  console.log(`Data directory: ${dataDir}`);
});

