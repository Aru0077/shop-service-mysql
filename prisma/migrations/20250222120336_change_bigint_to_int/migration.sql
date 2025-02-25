/*
  Warnings:

  - The primary key for the `admin_users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `last_login_time` on the `admin_users` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `admin_users` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `banner` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `banner` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `categories` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `categories` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `parent_id` on the `categories` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `images` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `images` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `products` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `sale_count` on the `products` table. All the data in the column will be lost.
  - You are about to alter the column `id` on the `products` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `category_id` on the `products` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `status` on the `products` table. The data in that column could be lost. The data in that column will be cast from `TinyInt` to `Enum(EnumId(0))`.
  - The primary key for the `user_addresses` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `user_addresses` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `user_cart_items` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `user_cart_items` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `product_id` on the `user_cart_items` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `sku_id` on the `user_cart_items` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `user_favorites` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to alter the column `id` on the `user_favorites` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - You are about to alter the column `product_id` on the `user_favorites` table. The data in that column could be lost. The data in that column will be cast from `BigInt` to `Int`.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the `product_attribute` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `product_attribute_value` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `product_attribute_value` DROP FOREIGN KEY `product_attribute_value_attr_id_fkey`;

-- DropForeignKey
ALTER TABLE `products` DROP FOREIGN KEY `products_category_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_addresses` DROP FOREIGN KEY `user_addresses_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_cart_items` DROP FOREIGN KEY `user_cart_items_product_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_cart_items` DROP FOREIGN KEY `user_cart_items_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_favorites` DROP FOREIGN KEY `user_favorites_product_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_favorites` DROP FOREIGN KEY `user_favorites_user_id_fkey`;

-- DropIndex
DROP INDEX `idx_category` ON `products`;

-- DropIndex
DROP INDEX `idx_name` ON `products`;

-- AlterTable
ALTER TABLE `admin_users` DROP PRIMARY KEY,
    DROP COLUMN `last_login_time`,
    ADD COLUMN `lastLoginTime` DATETIME(3) NULL,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `banner` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `categories` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `parent_id` INTEGER NOT NULL DEFAULT 0,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `images` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `products` DROP PRIMARY KEY,
    DROP COLUMN `sale_count`,
    ADD COLUMN `sales_count` INTEGER NULL DEFAULT 0,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `category_id` INTEGER NOT NULL,
    MODIFY `is_promotion` TINYINT NULL DEFAULT 0,
    MODIFY `status` ENUM('DRAFT', 'ONLINE', 'OFFLINE', 'DELETED') NULL DEFAULT 'DRAFT',
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `user_addresses` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `user_id` VARCHAR(36) NOT NULL,
    MODIFY `is_default` TINYINT NULL DEFAULT 0,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `user_cart_items` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `user_id` VARCHAR(36) NOT NULL,
    MODIFY `product_id` INTEGER NOT NULL,
    MODIFY `sku_id` INTEGER NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `user_favorites` DROP PRIMARY KEY,
    MODIFY `id` INTEGER NOT NULL AUTO_INCREMENT,
    MODIFY `user_id` VARCHAR(36) NOT NULL,
    MODIFY `product_id` INTEGER NOT NULL,
    ADD PRIMARY KEY (`id`);

-- AlterTable
ALTER TABLE `users` DROP PRIMARY KEY,
    MODIFY `id` VARCHAR(36) NOT NULL,
    ADD PRIMARY KEY (`id`);

-- DropTable
DROP TABLE `product_attribute`;

-- DropTable
DROP TABLE `product_attribute_value`;

-- CreateTable
CREATE TABLE `skus` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `price` INTEGER NOT NULL,
    `stock` INTEGER NULL DEFAULT 0,
    `locked_stock` INTEGER NULL DEFAULT 0,
    `sku_code` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `image` VARCHAR(255) NULL,
    `promotion_price` INTEGER NULL,

    INDEX `product_id`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `specs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,

    UNIQUE INDEX `name`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spec_values` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `spec_id` INTEGER NOT NULL,
    `value` VARCHAR(50) NOT NULL,

    UNIQUE INDEX `spec_id`(`spec_id`, `value`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sku_specs` (
    `sku_id` INTEGER NOT NULL,
    `spec_id` INTEGER NOT NULL,
    `spec_value_id` INTEGER NOT NULL,

    INDEX `idx_spec_value`(`spec_id`, `spec_value_id`),
    INDEX `sku_specs_ibfk_3`(`spec_value_id`),
    PRIMARY KEY (`sku_id`, `spec_id`, `spec_value_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(36) NOT NULL,
    `order_no` VARCHAR(32) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `order_status` TINYINT NULL DEFAULT 1,
    `payment_status` TINYINT NULL DEFAULT 0,
    `shipping_address` JSON NOT NULL,
    `total_amount` INTEGER NOT NULL,
    `payment_amount` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `order_no`(`order_no`),
    INDEX `idx_user_status`(`user_id`, `order_status`),
    INDEX `idx_status_created`(`order_status`, `created_at`),
    INDEX `idx_created`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` VARCHAR(36) NOT NULL,
    `sku_id` INTEGER NOT NULL,
    `product_name` VARCHAR(200) NOT NULL,
    `main_image` VARCHAR(255) NOT NULL,
    `sku_specs` JSON NOT NULL,
    `quantity` INTEGER NOT NULL,
    `unit_price` INTEGER NOT NULL,
    `total_price` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_sku_order`(`sku_id`, `order_id`),
    INDEX `order_id`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` VARCHAR(36) NOT NULL,
    `amount` INTEGER NOT NULL,
    `payment_type` VARCHAR(20) NOT NULL,
    `transaction_id` VARCHAR(64) NULL,
    `status` TINYINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_transaction`(`transaction_id`(32)),
    INDEX `order_id`(`order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sku_id` INTEGER NOT NULL,
    `change_quantity` INTEGER NOT NULL,
    `current_stock` INTEGER NOT NULL,
    `type` TINYINT NOT NULL,
    `order_no` VARCHAR(50) NULL,
    `remark` VARCHAR(255) NULL,
    `operator` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_name_status` ON `products`(`name`, `status`);

-- CreateIndex
CREATE INDEX `idx_promotion_status` ON `products`(`is_promotion`, `status`);

-- CreateIndex
CREATE INDEX `idx_category_status` ON `products`(`category_id`, `status`);

-- CreateIndex
CREATE INDEX `idx_name_code` ON `products`(`name`, `product_code`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `skus` ADD CONSTRAINT `skus_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `spec_values` ADD CONSTRAINT `spec_values_ibfk_1` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sku_specs` ADD CONSTRAINT `sku_specs_ibfk_1` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sku_specs` ADD CONSTRAINT `sku_specs_ibfk_2` FOREIGN KEY (`spec_id`) REFERENCES `specs`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `sku_specs` ADD CONSTRAINT `sku_specs_ibfk_3` FOREIGN KEY (`spec_value_id`) REFERENCES `spec_values`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `payment_logs` ADD CONSTRAINT `payment_logs_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `user_addresses` ADD CONSTRAINT `user_addresses_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `user_cart_items` ADD CONSTRAINT `user_cart_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_cart_items` ADD CONSTRAINT `user_cart_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_favorites` ADD CONSTRAINT `user_favorites_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_favorites` ADD CONSTRAINT `user_favorites_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
