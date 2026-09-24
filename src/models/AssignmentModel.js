import { prisma } from '../utils/db.js';

export class AssignmentModel {
    static async createMany(data) {  // FIXED: Loop with create for include
        const assignments = [];
        for (const assignmentData of data) {
            const assignment = await prisma.assignment.create({
                data: assignmentData,
                include: {
                    course: {
                        include: {
                            category: {
                                select: { id: true, name: true, slug: true },
                            },
                            certificateTemplate: {
                                select: { id: true, filename: true, description: true },
                            },
                        },
                    },
                    assigner: true,
                    assigneeUser: true
                }
            });
            assignments.push(assignment);
        }
        return assignments;
    }

    static async findByCourseId(courseId) {
        return prisma.assignment.findMany({
            where: { courseId },
            orderBy: { createdAt: 'desc' },
            include: {
                assigneeUser: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        orgId: true,
                        department: true,
                    },
                },
                course: {
                    select: {
                        id: true,
                        title: true,
                    },
                },
                assigner: { select: { id: true, fullName: true } },
            },
        });
    }

    static async findAssigneeIdsForCourse(courseId, learnerIds) {
        if (!Array.isArray(learnerIds) || learnerIds.length === 0) return [];
        const rows = await prisma.assignment.findMany({
            where: {
                courseId,
                assigneeUserId: { in: learnerIds },
            },
            select: { assigneeUserId: true },
        });
        return rows.map((row) => row.assigneeUserId).filter(Boolean);
    }

    static async findByCourseAndLearner(courseId, learnerId) {
        return prisma.assignment.findFirst({
            where: {
                courseId,
                assigneeUserId: learnerId
            }
        });
    }

    static async getAssignedCourses(learnerId) {  // FIXED: Renamed from findByLearnerId, full nested includes
        console.log('[ASSIGNMENT MODEL] getAssignedCourses for learnerId:', learnerId);
        return prisma.assignment.findMany({
            where: { assigneeUserId: learnerId },
            orderBy: { createdAt: 'desc' },
            include: {
                course: {
                    include: {
                        category: {
                            select: { id: true, name: true, slug: true, certificateTemplateId: true },
                        },
                        certificateTemplate: {
                            select: { id: true, filename: true, description: true },
                        },
                        modules: {
                            include: {
                                lessons: true
                            }
                        }
                    }
                },
                assigner: { select: { fullName: true } },
                assigneeUser: {  // FIXED: Nest attempts under assigneeUser
                    include: {
                        attempts: {
                            select: { status: true, completionPercentage: true, createdAt: true }
                        }
                    }
                }
            }
        });
    }

    static async getAssignedCourses(userId) {
        return prisma.assignment.findMany({
            where: { assigneeUserId: userId },
            include: {
                course: {
                    include: {
                        category: {
                            select: { id: true, name: true, slug: true, certificateTemplateId: true },
                        },
                        certificateTemplate: {
                            select: { id: true, filename: true, description: true },
                        },
                        modules: {
                            include: { lessons: true }
                        }
                    }
                },
                attempts: {
                    select: { status: true, completionPercentage: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }

    static async findByLearnerId(learnerId) {
        console.log('[ASSIGNMENT MODEL] findByLearnerId:', learnerId);

        return prisma.assignment.findMany({
            where: { assigneeUserId: learnerId },
            orderBy: { createdAt: 'desc' },
            include: {
                course: {
                    include: {
                        category: {
                            select: { id: true, name: true, slug: true, certificateTemplateId: true },
                        },
                        certificateTemplate: {
                            select: { id: true, filename: true, description: true },
                        },
                        modules: {
                            include: {
                                lessons: true
                            }
                        }
                    }
                },
                assigner: {
                    select: {
                        fullName: true,
                        email: true  // Optional: add more user info if needed
                    }
                },
                assigneeUser: {
                    include: {
                        // ✅ Use the correct relation name: "userAttempts" not "attempts"
                        userAttempts: {
                            select: {
                                status: true,
                                completionPercentage: true,
                                createdAt: true,
                                courseId: true  // Add this to filter by course
                            }
                        }
                    }
                }
            }
        });
    }

}

