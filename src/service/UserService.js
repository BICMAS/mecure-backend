import { UserModel } from '../models/UserModel.js';
import { OrganizationModel } from '../models/OrganizationModel.js';
import bcrypt from 'bcryptjs';

/** Trim and treat blank strings as null. */
const normalizeOptionalContact = (value) => {
    if (value == null) return null;
    const trimmed = String(value).trim();
    return trimmed.length > 0 ? trimmed : null;
};

const normalizeOptionalText = normalizeOptionalContact;

export class UserService {
    static sanitizeUser(user) {
        if (!user) return user;
        // Never return hashed password
        const { password, ...rest } = user;
        return rest;
    }

    static async getAllUsers(requester) {
        console.log('[SERVICE GET USERS] Role:', requester.userRole, 'OrgId:', requester.orgId);
        if (requester.userRole === 'SUPER_ADMIN') {
            const users = await UserModel.findAll(requester.userRole, requester.orgId);
            console.log('[SERVICE SUPER ADMIN] Returned', users.length, 'users');
            return users;
        } else if (requester.userRole === 'HR_MANAGER') {
            if (!requester.orgId) throw new Error('HR must be in an organization');
            const users = await UserModel.findByOrgId(requester.orgId);
            console.log('[SERVICE HR] Returned', users.length, 'org users');
            return users;
        } else {
            throw new Error('Insufficient role to view users');
        }
    }

    static async getCurrentOrgUsers(requester) {
        const timestamp = new Date().toISOString();
        console.log(`[ORG SVC START] ${timestamp} - Role: ${requester.userRole}, orgId: ${requester.orgId}`);

        if (requester.userRole !== 'HR_MANAGER' && requester.userRole !== 'SUPER_ADMIN') {
            console.log(`[ORG SVC FAIL] ${timestamp} - Insufficient role`);
            throw new Error('Access denied—only HR and super admin can view org users');
        }

        if (!requester.orgId) {
            console.log(`[ORG SVC FAIL] ${timestamp} - No orgId`);
            throw new Error('No organization found for user');
        }

        const users = await UserModel.findByOrgId(requester.orgId);
        console.log(`[ORG SVC END] ${timestamp} - Found ${users.length} users for org ${requester.orgId}`);
        if (users.length === 0) {
            console.log(`[ORG SVC NOTE] ${timestamp} - Empty org, returning []`);
        }
        return users;
    }

    static async getUser(id, requester) {
        const user = await UserModel.findById(id);
        if (!user) throw new Error('User not found');

        if (requester.userRole === 'HR_MANAGER') {
            if (!requester.orgId || user.orgId !== requester.orgId) {
                throw new Error('Access denied');
            }
        } else if (requester.userRole !== 'SUPER_ADMIN') {
            throw new Error('Insufficient role to view users');
        }

        return UserService.sanitizeUser(user);
    }

    static async createUser(data, creator) {
        const { fullName, department, userRole, groupId, password, username } = data;
        const email = normalizeOptionalContact(data.email);
        const phoneNumber = normalizeOptionalContact(data.phoneNumber);
        const designation = normalizeOptionalText(data.designation);

        if (!fullName || !userRole || !department || !password) {
            throw new Error('Required fields: fullName, userRole, department, password');
        }

        if (!email && !phoneNumber) {
            throw new Error('Either email or phone number is required');
        }

        let orgId = null;
        if (creator.userRole === 'SUPER_ADMIN') {
            if (userRole === 'HR_MANAGER') {
                const org = await OrganizationModel.create({
                    name: `Org for ${fullName}`,
                    createdBy: creator.id
                });
                orgId = org.id;
            }
        } else if (creator.userRole === 'HR_MANAGER') {
            if (!creator.orgId) throw new Error('HR must be in an organization');
            orgId = creator.orgId;
            if (userRole !== 'LEARNER') throw new Error('HR can only create learners');
        } else {
            throw new Error('Insufficient role to create users');
        }

        if (email) {
            const existingEmail = await UserModel.findByEmail(email);
            if (existingEmail) throw new Error('Email already exists');
        }

        if (phoneNumber) {
            const existingPhone = await UserModel.findByPhone(phoneNumber);
            if (existingPhone) throw new Error('Phone number already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = await UserModel.create({
            fullName,
            email,
            username,
            phoneNumber,
            department,
            designation,
            userRole,
            password: hashedPassword,
            orgId,
            status: 'ACTIVE',
            authProvider: 'LOCAL'
        });

        if (groupId) {
            // await GroupMemberModel.create({ groupId, userId: user.id, role: 'MEMBER' });
        }

        return { ...user, password: undefined };
    }

    static async updateUser(id, updates, requester) {
        if (!id) throw new Error('User ID required');
        if (!updates || typeof updates !== 'object') throw new Error('Updates payload required');

        const existing = await UserModel.findById(id);
        if (!existing) throw new Error('User not found');

        // HR can only manage users within their org and should not be able to escalate roles
        const requesterRole = requester?.userRole;
        const requesterOrgId = requester?.orgId;

        if (requesterRole === 'HR_MANAGER') {
            if (!requesterOrgId) throw new Error('HR must be in an organization');
            if (existing.orgId !== requesterOrgId) throw new Error('Access denied');
        } else if (!requesterRole || requesterRole !== 'SUPER_ADMIN') {
            throw new Error('Insufficient role to update users');
        }

        const allowedFields = requesterRole === 'HR_MANAGER'
            ? [
                'fullName',
                'email',
                'phoneNumber',
                'department',
                'designation',
                'username',
                'groupId',
                'status',
                'authProvider',
                'points'
            ]
            : [
                'fullName',
                'email',
                'phoneNumber',
                'department',
                'designation',
                'userRole',
                'username',
                'orgId',
                'groupId',
                'status',
                'authProvider',
                'points'
            ];

        const data = {};
        for (const key of allowedFields) {
            if (Object.prototype.hasOwnProperty.call(updates, key)) {
                if (key === 'email' || key === 'phoneNumber' || key === 'designation') {
                    data[key] = normalizeOptionalText(updates[key]);
                } else {
                    data[key] = updates[key];
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(updates, 'password')) {
            if (!updates.password) throw new Error('Password cannot be empty');
            data.password = await bcrypt.hash(updates.password, 12);
        }

        const nextEmail = Object.prototype.hasOwnProperty.call(data, 'email')
            ? data.email
            : existing.email;
        const nextPhone = Object.prototype.hasOwnProperty.call(data, 'phoneNumber')
            ? data.phoneNumber
            : existing.phoneNumber;

        if (!nextEmail && !nextPhone) {
            throw new Error('Either email or phone number is required');
        }

        if (data.email && data.email !== existing.email) {
            const existingEmail = await UserModel.findByEmail(data.email);
            if (existingEmail && existingEmail.id !== id) {
                throw new Error('Email already exists');
            }
        }

        if (data.phoneNumber && data.phoneNumber !== existing.phoneNumber) {
            const existingPhone = await UserModel.findByPhone(data.phoneNumber);
            if (existingPhone && existingPhone.id !== id) {
                throw new Error('Phone number already exists');
            }
        }

        const updated = await UserModel.update(id, data);
        return UserService.sanitizeUser(updated);
    }

    static async blockUser(id) {
        const existing = await UserModel.findById(id);
        if (!existing) throw new Error('User not found');
        const updated = await UserModel.update(id, { status: 'BLOCKED' });
        return UserService.sanitizeUser(updated);
    }

    static async unblockUser(id) {
        const existing = await UserModel.findById(id);
        if (!existing) throw new Error('User not found');
        const updated = await UserModel.update(id, { status: 'ACTIVE' });
        return UserService.sanitizeUser(updated);
    }

    static async deleteUser(id, requester) {
        const existing = await UserModel.findById(id);
        if (!existing) throw new Error('User not found');

        if (!requester?.userRole) throw new Error('Insufficient role to delete users');
        if (existing.userRole === 'SUPER_ADMIN') throw new Error('Cannot delete SUPER_ADMIN');

        if (requester.userRole === 'HR_MANAGER') {
            if (!requester.orgId) throw new Error('HR must be in an organization');
            if (existing.orgId !== requester.orgId) throw new Error('Access denied');
        } else if (requester.userRole !== 'SUPER_ADMIN') {
            throw new Error('Insufficient role to delete users');
        }

        await UserModel.deleteById(id);
        return UserService.sanitizeUser(existing);
    }

    static async bulkUpload(rows, creator) {
        if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error('CSV data required');
        }

        if (creator.userRole !== 'SUPER_ADMIN' && creator.userRole !== 'HR_MANAGER') {
            throw new Error('Insufficient role to bulk upload users');
        }

        const usersToCreate = [];

        for (const [index, row] of rows.entries()) {
            const fullName = row.fullName || row.full_name || row.name;
            const email = normalizeOptionalContact(row.email);
            const password = row.password || row.temporaryPassword;
            const department = row.department;
            const userRole = row.userRole || row.user_role || 'LEARNER';
            const username = row.username || null;
            const phoneNumber = normalizeOptionalContact(
                row.phoneNumber || row.phone_number
            );
            const designation = normalizeOptionalText(
                row.designation || row.job_title || row.title
            );

            if (!fullName || !password || !department) {
                throw new Error(`Row ${index + 1}: fullName, password, and department are required`);
            }

            if (!email && !phoneNumber) {
                throw new Error(`Row ${index + 1}: either email or phone number is required`);
            }

            if (creator.userRole === 'HR_MANAGER' && userRole !== 'LEARNER') {
                throw new Error(`Row ${index + 1}: HR can only create learners`);
            }

            let skip = false;
            if (email) {
                const existingEmail = await UserModel.findByEmail(email);
                if (existingEmail) skip = true;
            }
            if (!skip && phoneNumber) {
                const existingPhone = await UserModel.findByPhone(phoneNumber);
                if (existingPhone) skip = true;
            }
            if (skip) continue;

            usersToCreate.push({
                fullName,
                email,
                username,
                phoneNumber,
                department,
                designation,
                userRole,
                password: await bcrypt.hash(password, 12),
                orgId: creator.userRole === 'HR_MANAGER' ? creator.orgId : (row.orgId || null),
                status: 'ACTIVE',
                authProvider: 'LOCAL',
            });
        }

        if (usersToCreate.length === 0) {
            return { created: 0, skipped: rows.length, message: 'No new users to create' };
        }

        const result = await UserModel.bulkCreate(usersToCreate);
        return {
            created: result.count,
            skipped: rows.length - result.count,
        };
    }
}
