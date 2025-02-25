// src/scripts/createSuperAdmin.ts
import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcrypt';
import dotenv from 'dotenv';

dotenv.config();

const SALT_ROUNDS = 10;

async function createSuperAdmin() {
    const prisma = new PrismaClient({
        log: ['error'],
    });

    try {
        // Check if admin already exists
        const existingAdmin = await prisma.adminUser.findUnique({
            where: { username: 'admin' }
        });

        if (existingAdmin) {
            console.error('❌ Super admin with username "admin" already exists');
            return;
        }

        // Create super admin
        const hashedPassword = hashSync('240414', SALT_ROUNDS);
        const superAdmin = await prisma.adminUser.create({
            data: {
                username: 'admin',
                password: hashedPassword,
                isSuper: true,
                status: 1
            }
        });

        console.log('✅ Super admin created successfully:', {
            id: superAdmin.id,  // 直接输出数字 ID
            username: superAdmin.username,
            isSuper: superAdmin.isSuper,
            status: superAdmin.status
        });

    } catch (error) {
        console.error('❌ Error creating super admin:', error);
    } finally {
        await prisma.$disconnect();
    }
}

createSuperAdmin();