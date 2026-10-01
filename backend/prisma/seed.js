const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting Krishi Suraksha database seed...');

  // Clean existing data in reverse dependency order
  await prisma.payment.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cropListing.deleteMany();
  await prisma.farmerProfile.deleteMany();
  await prisma.buyerProfile.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();

  console.log('🧹 Existing data cleaned.');

  const defaultPasswordHash = await bcrypt.hash('pass123', 10);
  const adminPasswordHash = await bcrypt.hash('admin123', 10);

  // 1. Create Admin
  const adminUser = await prisma.user.create({
    data: {
      name: 'Karnataka Agri Department Admin',
      phoneNumber: '+919999999999',
      email: 'admin@krishisuraksha.gov.in',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      preferredLang: 'en'
    }
  });

  console.log(`✅ Admin created: ${adminUser.name} (${adminUser.email})`);

  // 2. Create Farmer 1 (Chikkamagaluru - Coffee & Avocado)
  const farmer1 = await prisma.user.create({
    data: {
      name: 'Ramesh Gowda',
      phoneNumber: '+919876543210',
      passwordHash: defaultPasswordHash,
      role: 'FARMER',
      preferredLang: 'kn',
      farmerProfile: {
        create: {
          state: 'Karnataka',
          district: 'Chikkamagaluru',
          village: 'Mudigere',
          upiId: 'rameshgowda@oksbi'
        }
      }
    },
    include: { farmerProfile: true }
  });

  // 3. Create Farmer 2 (Ramanagara - Dragon Fruit & Pomegranate)
  const farmer2 = await prisma.user.create({
    data: {
      name: 'Suresh Patel',
      phoneNumber: '+919876543211',
      passwordHash: defaultPasswordHash,
      role: 'FARMER',
      preferredLang: 'en',
      farmerProfile: {
        create: {
          state: 'Karnataka',
          district: 'Ramanagara',
          village: 'Kanakapura',
          upiId: 'sureshpatel@ybl'
        }
      }
    },
    include: { farmerProfile: true }
  });

  // 4. Create Farmer 3 (Shimoga - High-Value Bananas)
  const farmer3 = await prisma.user.create({
    data: {
      name: 'Manjunath Hegde',
      phoneNumber: '+919876543212',
      passwordHash: defaultPasswordHash,
      role: 'FARMER',
      preferredLang: 'kn',
      farmerProfile: {
        create: {
          state: 'Karnataka',
          district: 'Shimoga',
          village: 'Thirthahalli',
          upiId: 'mhegde@icici'
        }
      }
    },
    include: { farmerProfile: true }
  });

  console.log('✅ Farmers created: Ramesh Gowda, Suresh Patel, Manjunath Hegde');

  // 5. Create Buyer 1 (Supermarket Chain)
  const buyer1 = await prisma.user.create({
    data: {
      name: 'Ananya Sharma',
      phoneNumber: '+919811122233',
      email: 'procurement@freshworldmarkets.com',
      passwordHash: defaultPasswordHash,
      role: 'BUYER',
      preferredLang: 'en',
      buyerProfile: {
        create: {
          businessName: 'FreshWorld Supermarkets Pvt Ltd',
          businessType: 'Supermarket',
          shippingAddress: 'Plot 42, Export Promotion Industrial Park, Whitefield, Bengaluru, Karnataka 560066',
          gstin: '29AABCU9603R1ZX'
        }
      }
    }
  });

  // 6. Create Buyer 2 (Luxury Hotel & Gourmet Kitchens)
  const buyer2 = await prisma.user.create({
    data: {
      name: 'Chef Vikram Rao',
      phoneNumber: '+919822233344',
      email: 'purchase@grandorchidhotel.com',
      passwordHash: defaultPasswordHash,
      role: 'BUYER',
      preferredLang: 'en',
      buyerProfile: {
        create: {
          businessName: 'The Grand Orchid Luxury Hotel',
          businessType: 'Hotel',
          shippingAddress: '7 MG Road, Central Business District, Bengaluru, Karnataka 560001',
          gstin: '29AAGCB1234F1Z0'
        }
      }
    }
  });

  console.log('✅ Buyers created: FreshWorld Supermarkets, The Grand Orchid');

  // Harvest date helpers
  const now = new Date();
  const inDays = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // 7. Seed Listings for High-Value Crops
  const listings = [
    {
      farmerId: farmer1.farmerProfile.id,
      cropName: 'Avocado',
      variety: 'Hass (Grade A Organic)',
      totalQuantityKg: 850,
      availableQuantityKg: 850,
      askingPricePerKg: 220,
      suggestedMinPrice: 195,
      suggestedMaxPrice: 240,
      expectedHarvestDate: inDays(14),
      location: 'Mudigere, Chikkamagaluru, Karnataka',
      photoUrl: 'https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=800&auto=format&fit=crop&q=80',
      isActive: true
    },
    {
      farmerId: farmer1.farmerProfile.id,
      cropName: 'Coffee',
      variety: 'Arabica Plantation A (Shade-grown)',
      totalQuantityKg: 1500,
      availableQuantityKg: 1500,
      askingPricePerKg: 380,
      suggestedMinPrice: 350,
      suggestedMaxPrice: 410,
      expectedHarvestDate: inDays(28),
      location: 'Mudigere, Chikkamagaluru, Karnataka',
      photoUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&auto=format&fit=crop&q=80',
      isActive: true
    },
    {
      farmerId: farmer2.farmerProfile.id,
      cropName: 'Dragon Fruit',
      variety: 'Red Flesh (Siam Red)',
      totalQuantityKg: 1200,
      availableQuantityKg: 1200,
      askingPricePerKg: 160,
      suggestedMinPrice: 145,
      suggestedMaxPrice: 185,
      expectedHarvestDate: inDays(10),
      location: 'Kanakapura, Ramanagara, Karnataka',
      photoUrl: 'https://images.unsplash.com/photo-1527325678964-54921661f888?w=800&auto=format&fit=crop&q=80',
      isActive: true
    },
    {
      farmerId: farmer2.farmerProfile.id,
      cropName: 'Pomegranate',
      variety: 'Bhagwa (Export Quality)',
      totalQuantityKg: 2500,
      availableQuantityKg: 2500,
      askingPricePerKg: 175,
      suggestedMinPrice: 155,
      suggestedMaxPrice: 195,
      expectedHarvestDate: inDays(21),
      location: 'Kanakapura, Ramanagara, Karnataka',
      photoUrl: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800&auto=format&fit=crop&q=80',
      isActive: true
    },
    {
      farmerId: farmer3.farmerProfile.id,
      cropName: 'Banana',
      variety: 'Nanjangud Rasabale (GI Tagged)',
      totalQuantityKg: 3000,
      availableQuantityKg: 3000,
      askingPricePerKg: 45,
      suggestedMinPrice: 38,
      suggestedMaxPrice: 50,
      expectedHarvestDate: inDays(7),
      location: 'Thirthahalli, Shimoga, Karnataka',
      photoUrl: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=800&auto=format&fit=crop&q=80',
      isActive: true
    }
  ];

  for (const item of listings) {
    await prisma.cropListing.create({ data: item });
  }

  console.log(`✅ 5 High-Value Crop Listings seeded (Avocado, Coffee, Dragon Fruit, Pomegranate, Banana).`);
  console.log('🌾 Seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
