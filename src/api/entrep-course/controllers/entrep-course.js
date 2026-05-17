'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

async function resolveUser(strapi, ctx) {
  if (ctx.state.user?.id) {
    return strapi.entityService.findOne('plugin::users-permissions.user', ctx.state.user.id, { populate: ['role'] });
  }
  return null;
}

async function getProfile(strapi, userId) {
  const list = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: userId }, limit: 1,
  });
  return list?.[0] || null;
}

function isAdminUser(user, profile) {
  return user?.role?.type === 'admin' || user?.role?.name === 'Admin' || profile?.role === 'admin';
}

function hasOverviewAccess(user, profile) {
  return isAdminUser(user, profile) || profile?.role === 'me';
}

async function getManagedCourse(strapi, user, profile, courseId) {
  const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', courseId, {
    populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
  });
  if (!course) return null;

  const isAdmin = isAdminUser(user, profile);
  const ownsCourse = profile?.id && Number(course.trainer?.id) === Number(profile.id);
  if (!isAdmin && !ownsCourse) return false;
  return course;
}

async function listCourseEnrollments(strapi, courseId) {
  return strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
    filters: { course: courseId },
    populate: ['user'],
    sort: { enrolledAt: 'desc' },
  });
}

async function getProfilesByUserIds(strapi, userIds) {
  if (!userIds.length) return new Map();
  const profiles = await strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
    filters: { user: { id: { $in: userIds } } },
    populate: ['user'],
  });
  return new Map(profiles.map((profile) => [Number(profile.user?.id), profile]));
}

function getDisplayName(user, profile, fallback = 'Learner') {
  return profile?.fullName || user?.fullName || user?.name || user?.username || user?.email || fallback;
}

function withPostedByName(job) {
  return {
    ...job,
    postedByName: getDisplayName(job.postedBy, job.postedByProfile, 'Community Member'),
  };
}

function summarizeCourseMetrics(enrollments) {
  const totalLearners = enrollments.length;
  const completedLearners = enrollments.filter((enrollment) => enrollment.status === 'completed' || enrollment.certificateIssued).length;
  const averageProgress = totalLearners
    ? Math.round(enrollments.reduce((sum, enrollment) => sum + Number(enrollment.progressPct || 0), 0) / totalLearners)
    : 0;

  return {
    totalLearners,
    completedLearners,
    activeLearners: Math.max(totalLearners - completedLearners, 0),
    averageProgress,
  };
}

function serializeCluster(cluster) {
  if (!cluster) return null;

  return {
    id: cluster.id,
    name: cluster.name || cluster.organizationName || 'Cluster',
    organizationName: cluster.organizationName || '',
    region: cluster.region || '',
    contactPerson: cluster.contactPerson || '',
    contactEmail: cluster.contactEmail || '',
    contactPhone: cluster.contactPhone || '',
  };
}

function resolveMarketplaceProductImage(product) {
  if (typeof product?.featuredImage === 'string' && product.featuredImage.trim()) {
    return product.featuredImage.trim();
  }

  if (Array.isArray(product?.imageUrls)) {
    const firstImage = product.imageUrls.find((value) => String(value || '').trim());
    if (firstImage) return String(firstImage).trim();
  }

  if (Array.isArray(product?.images)) {
    const firstImage = product.images.find((value) => String(value || '').trim());
    if (firstImage) return String(firstImage).trim();
  }

  return '';
}

function serializeMarketplaceProduct(product, sellerProfile, source = 'entrep') {
  return {
    id: `${source}-${product.id}`,
    source,
    name: product.name || 'Product',
    category: product.category || '',
    priceUGX: Number(product.priceUGX || 0),
    status: product.status || 'approved',
    imageUrl: resolveMarketplaceProductImage(product),
    sellerName: product.sellerDisplayName || product.sellerName || sellerProfile?.fullName || product.seller?.fullName || product.seller?.username || 'Marketplace seller',
    sellerProfilePhotoUrl: sellerProfile?.profilePhotoUrl || product.sellerProfilePhotoUrl || '',
    createdAt: product.createdAt || null,
    sellerProfileId: sellerProfile?.id || null,
    sellerUserId: Number(product.seller?.id || product.seller || sellerProfile?.user?.id || sellerProfile?.user) || null,
    sellerRole: sellerProfile?.role || null,
    cluster: serializeCluster(sellerProfile?.cluster),
  };
}

module.exports = createCoreController('api::entrep-course.entrep-course', ({ strapi }) => ({
  /**
   * Default `find` enriched to deep-populate modules & lessons for the catalog.
   */
  async find(ctx) {
    const params = ctx.query;
    const filters = { ...(params.filters || {}) };
    
    // If no status is provided, we default to approved for the general catalog.
    // However, we allow explicitly filtering by status if provided (e.g. status: { $in: ['draft', 'approved'] })
    if (!filters.status) {
      filters.status = 'approved';
    }

    const list = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
      filters,
      sort: params.sort || { createdAt: 'desc' },
      populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
    });
    ctx.send({ data: list });
  },

  async findOne(ctx) {
    const course = await strapi.entityService.findOne('api::entrep-course.entrep-course', ctx.params.id, {
      populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
    });
    if (!course) return ctx.notFound();
    ctx.send({ data: course });
  },

  /**
   * POST /entrep/courses (trainer authoring)
   * Body: course fields + { modules: [{ title, description, lessons: [...], quiz: {...} }] }
   */
  async authorCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    const adminUser = isAdminUser(user, profile);
    if ((!profile && !adminUser) || (profile && !['trainer', 'admin', 'provider'].includes(profile.role) && !adminUser)) {
      return ctx.forbidden('Only trainers or admins can author courses');
    }

    const b = ctx.request.body || {};
    if (!b.title) return ctx.badRequest('title is required');

    const course = await strapi.entityService.create('api::entrep-course.entrep-course', {
      data: {
        title: b.title,
        shortDescription: b.shortDescription,
        description: b.description,
        category: b.category,
        level: b.level || 'Beginner',
        skills: b.skills || [],
        durationWeeks: b.durationWeeks || 0,
        coverUrl: b.coverUrl,
        previewVideoUrl: b.previewVideoUrl,
        coverGradient: b.coverGradient,
        accent: b.accent,
        priceUGX: b.priceUGX || 0,
        passMark: b.passMark || 80,
        providerName: b.providerName || profile?.fullName || user.username || user.email,
        trainer: profile?.id || null,
        status: adminUser ? 'approved' : 'pending_review',
      },
    });

    // Modules + lessons + quiz
    if (Array.isArray(b.modules)) {
      for (let mi = 0; mi < b.modules.length; mi++) {
        const m = b.modules[mi];
        let quizEntity = null;
        if (m.quiz && Array.isArray(m.quiz.questions) && m.quiz.questions.length) {
          quizEntity = await strapi.entityService.create('api::entrep-quiz.entrep-quiz', {
            data: {
              title: m.quiz.title || `${m.title} quiz`,
              instructions: m.quiz.instructions,
              passMark: m.quiz.passMark || b.passMark || 80,
              maxAttempts: m.quiz.maxAttempts || 3,
              timeLimitMinutes: m.quiz.timeLimitMinutes || 0,
              questions: m.quiz.questions.map((q, i) => ({ id: q.id || `q${mi}_${i}`, ...q })),
              course: course.id,
            },
          });
        }
        const moduleEntity = await strapi.entityService.create('api::entrep-module.entrep-module', {
          data: {
            title: m.title,
            description: m.description,
            order: mi,
            course: course.id,
            quiz: quizEntity?.id || null,
          },
        });
        if (Array.isArray(m.lessons)) {
          for (let li = 0; li < m.lessons.length; li++) {
            const l = m.lessons[li];
            await strapi.entityService.create('api::entrep-lesson.entrep-lesson', {
              data: {
                title: l.title,
                description: l.description,
                order: li,
                lessonType: l.lessonType || 'video',
                videoUrl: l.videoUrl,
                pdfUrl: l.pdfUrl,
                imageUrl: l.imageUrl,
                bodyText: l.bodyText,
                durationMin: l.durationMin || 0,
                module: moduleEntity.id,
              },
            });
          }
        }
      }
    }

    const populated = await strapi.entityService.findOne('api::entrep-course.entrep-course', course.id, {
      populate: { modules: { populate: ['lessons', 'quiz'] } },
    });
    ctx.send({ course: populated });
  },

  /**
   * GET /entrep/me/courses – courses authored by the current trainer.
   */
  async myAuthoredCourses(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    if (!profile) return ctx.send({ data: [] });
    const list = await strapi.entityService.findMany('api::entrep-course.entrep-course', {
      filters: { trainer: profile.id },
      populate: { modules: { populate: ['lessons', 'quiz'] } },
      sort: { createdAt: 'desc' },
    });

    const courseIds = list.map((course) => course.id).filter(Boolean);
    const enrollments = courseIds.length
      ? await strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
          filters: { course: { id: { $in: courseIds } } },
          populate: ['course'],
        })
      : [];

    const metricsByCourseId = enrollments.reduce((acc, enrollment) => {
      const key = Number(enrollment.course?.id || enrollment.course);
      if (!key) return acc;
      acc[key] = acc[key] || [];
      acc[key].push(enrollment);
      return acc;
    }, {});

    ctx.send({
      data: list.map((course) => ({
        ...course,
        metrics: summarizeCourseMetrics(metricsByCourseId[course.id] || []),
      })),
    });
  },

  async adminOverview(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    if (!hasOverviewAccess(user, profile)) return ctx.forbidden('Admin or M&E only');

    const [profiles, courses, enrollments, jobs, posts, discussionGroups, sessions, allClusters, products, coreMarketplaceProducts] = await Promise.all([
      strapi.entityService.findMany('api::entrep-profile.entrep-profile', {
        sort: { createdAt: 'desc' },
        populate: ['user', 'cluster'],
      }),
      strapi.entityService.findMany('api::entrep-course.entrep-course', {
        sort: { createdAt: 'desc' },
        populate: ['trainer', 'modules'],
      }),
      strapi.entityService.findMany('api::entrep-enrollment.entrep-enrollment', {
        sort: { enrolledAt: 'desc' },
        populate: {
          user: true,
          course: { populate: ['trainer'] },
        },
      }),
      strapi.entityService.findMany('api::entrep-job.entrep-job', {
        sort: { createdAt: 'desc' },
        populate: ['postedBy', 'postedByProfile'],
      }),
      strapi.entityService.findMany('api::entrep-post.entrep-post', {
        sort: { createdAt: 'desc' },
        populate: ['author', 'discussionGroup'],
      }),
      strapi.entityService.findMany('api::entrep-discussion-group.entrep-discussion-group', {
        sort: { createdAt: 'desc' },
        populate: ['course', 'members'],
      }),
      strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
        sort: { startsAt: 'desc' },
        populate: ['trainer', 'course'],
      }),
      strapi.entityService.findMany('api::entrep-cluster.entrep-cluster', {
        sort: { createdAt: 'desc' },
      }),
      strapi.entityService.findMany('api::entrep-product.entrep-product', {
        sort: { createdAt: 'desc' },
        populate: { seller: { populate: ['user', 'cluster'] } },
      }),
      strapi.documents('api::product.product').findMany({
        filters: { marketplaceSource: 'entrepreneur' },
        populate: { seller: true },
        sort: { createdAt: 'desc' },
        status: 'published',
      }).catch(() => []),
    ]);

    const profileByUserId = new Map(
      profiles.map((item) => [Number(item.user?.id), item]).filter(([userId]) => Boolean(userId))
    );

    const allMarketplaceProducts = [
      ...products.map((product) => ({
        source: 'entrep',
        product,
        sellerProfile: product.seller || null,
      })),
      ...coreMarketplaceProducts.map((product) => ({
        source: 'core',
        product,
        sellerProfile: profileByUserId.get(Number(product.seller?.id || product.seller)) || null,
      })),
    ];

    const productsBySellerProfileId = allMarketplaceProducts.reduce((acc, entry) => {
      const { product, sellerProfile, source } = entry;
      const key = Number(sellerProfile?.id);
      if (!key) return acc;
      acc[key] = acc[key] || [];
      acc[key].push(serializeMarketplaceProduct(product, sellerProfile, source));
      return acc;
    }, {});

    const enrollmentsByUserId = enrollments.reduce((acc, enrollment) => {
      const key = Number(enrollment.user?.id || enrollment.user);
      if (!key) return acc;
      acc[key] = acc[key] || [];
      acc[key].push(enrollment);
      return acc;
    }, {});

    const coursesByTrainerId = courses.reduce((acc, course) => {
      const key = Number(course.trainer?.id || course.trainer);
      if (!key) return acc;
      acc[key] = acc[key] || [];
      acc[key].push(course);
      return acc;
    }, {});

    const learners = profiles
      .filter((item) => item.role === 'learner')
      .map((item) => {
        const userEnrollments = enrollmentsByUserId[Number(item.user?.id)] || [];
        const learnerProducts = productsBySellerProfileId[Number(item.id)] || [];
        return {
          id: item.id,
          name: item.fullName,
          profilePhotoUrl: item.profilePhotoUrl || '',
          email: item.email || item.user?.email || '',
          phone: item.phone || item.user?.phone || '',
          location: item.location || '',
          address: item.location || '',
          age: Number(item.age || 0) || null,
          dateOfBirth: item.dateOfBirth || null,
          registeredAt: item.createdAt || item.user?.createdAt || null,
          approvalStatus: item.approvalStatus,
          cluster: serializeCluster(item.cluster),
          products: learnerProducts,
          productsCount: learnerProducts.length,
          progress: userEnrollments.map((enrollment) => ({
            enrollmentId: enrollment.id,
            courseId: enrollment.course?.id || null,
            courseTitle: enrollment.course?.title || 'Course',
            trainerName: enrollment.course?.trainer?.fullName || enrollment.course?.providerName || 'Unknown trainer',
            progressPct: Math.round(Number(enrollment.progressPct || 0)),
            overallScore: Math.round(Number(enrollment.overallScore || 0)),
            status: enrollment.status,
            certificateIssued: !!enrollment.certificateIssued,
            enrolledAt: enrollment.enrolledAt,
            completedAt: enrollment.completedAt,
          })),
          statusSummary: {
            activeCourses: userEnrollments.filter((enrollment) => enrollment.status === 'active').length,
            completedCourses: userEnrollments.filter((enrollment) => enrollment.status === 'completed' || enrollment.certificateIssued).length,
          },
        };
      });

    const trainers = profiles
      .filter((item) => item.role === 'trainer')
      .map((item) => {
        const trainerProducts = productsBySellerProfileId[Number(item.id)] || [];
        return {
          id: item.id,
          name: item.fullName,
          profilePhotoUrl: item.profilePhotoUrl || '',
          email: item.email || item.user?.email || '',
          phone: item.phone || item.user?.phone || '',
          location: item.location || '',
          address: item.location || '',
          age: Number(item.age || 0) || null,
          registeredAt: item.createdAt || item.user?.createdAt || null,
          approvalStatus: item.approvalStatus,
          cluster: serializeCluster(item.cluster),
          products: trainerProducts,
          productsCount: trainerProducts.length,
          courses: (coursesByTrainerId[Number(item.id)] || []).map((course) => ({
            id: course.id,
            title: course.title,
            status: course.status,
            category: course.category || '',
            level: course.level || 'Beginner',
            enrollmentsCount: Number(course.enrollmentsCount || 0),
            modulesCount: Array.isArray(course.modules) ? course.modules.length : 0,
            createdAt: course.createdAt || null,
          })),
        };
      });

    const experts = profiles
      .filter((item) => item.role === 'provider')
      .map((item) => {
        const expertProducts = productsBySellerProfileId[Number(item.id)] || [];
        return {
          id: item.id,
          name: item.fullName,
          profilePhotoUrl: item.profilePhotoUrl || '',
          email: item.email || item.user?.email || '',
          phone: item.phone || item.user?.phone || '',
          location: item.location || '',
          address: item.location || '',
          age: Number(item.age || 0) || null,
          registeredAt: item.createdAt || item.user?.createdAt || null,
          approvalStatus: item.approvalStatus,
          cluster: serializeCluster(item.cluster),
          isMentor: !!item.isMentor,
          mentorRating: Number(item.mentorRating || 0),
          sessionsHosted: Number(item.sessionsHosted || 0),
          products: expertProducts,
          productsCount: expertProducts.length,
          courses: (coursesByTrainerId[Number(item.id)] || []).map((course) => ({
            id: course.id,
            title: course.title,
            status: course.status,
            createdAt: course.createdAt || null,
          })),
        };
      });

    const clusterSummaries = allClusters.map((cluster) => {
      const members = profiles.filter((item) => Number(item.cluster?.id || item.cluster) === Number(cluster.id));
      const clusterAdminProfile = members.find((item) => item.role === 'cluster');
      return {
        id: cluster.id,
        profileId: clusterAdminProfile?.id || null,
        name: cluster.name || cluster.organizationName || 'Cluster',
        organizationName: cluster.organizationName || '',
        region: cluster.region || '',
        contactPerson: cluster.contactPerson || '',
        contactEmail: cluster.contactEmail || '',
        contactPhone: cluster.contactPhone || '',
        approvalStatus: clusterAdminProfile?.approvalStatus || 'approved',
        createdAt: cluster.createdAt || clusterAdminProfile?.createdAt || null,
        counts: {
          learners: members.filter((item) => item.role === 'learner').length,
          trainers: members.filter((item) => item.role === 'trainer').length,
          experts: members.filter((item) => item.role === 'provider').length,
          clusterAdmins: members.filter((item) => item.role === 'cluster').length,
        },
        members: members.map((item) => ({
          id: item.id,
          name: item.fullName,
          profilePhotoUrl: item.profilePhotoUrl || '',
          role: item.role,
          approvalStatus: item.approvalStatus,
          email: item.email || item.user?.email || '',
          registeredAt: item.createdAt || item.user?.createdAt || null,
        })),
      };
    });

    const suggestions = posts
      .filter((post) => post.postType === 'suggestion')
      .map((post) => {
        const suggestionProfile = profileByUserId.get(Number(post.author?.id || post.author));
        return {
          id: post.id,
          title: post.title || '',
          content: post.content || '',
          authorName: post.authorName || suggestionProfile?.fullName || 'Learner',
          isAnonymous: !!post.isAnonymous,
          createdAt: post.createdAt || null,
          cluster: serializeCluster(suggestionProfile?.cluster),
          learner: suggestionProfile ? {
            id: suggestionProfile.id,
            profilePhotoUrl: suggestionProfile.profilePhotoUrl || '',
            email: suggestionProfile.email || suggestionProfile.user?.email || '',
            phone: suggestionProfile.phone || suggestionProfile.user?.phone || '',
            location: suggestionProfile.location || '',
          } : null,
        };
      });

    const serializedProducts = allMarketplaceProducts.map(({ product, sellerProfile, source }) => (
      serializeMarketplaceProduct(product, sellerProfile, source)
    ));

    ctx.send({
      data: {
        stats: {
          learners: learners.length,
          trainers: trainers.length,
          experts: experts.length,
          clusters: clusterSummaries.length,
          pendingClusters: clusterSummaries.filter((item) => item.approvalStatus === 'pending').length,
          courses: courses.length,
          products: serializedProducts.length,
          suggestions: suggestions.length,
          activeEnrollments: enrollments.filter((item) => item.status === 'active').length,
          completedEnrollments: enrollments.filter((item) => item.status === 'completed' || item.certificateIssued).length,
          jobs: jobs.length,
          openJobs: jobs.filter((item) => item.status === 'open').length,
          communityPosts: posts.filter((item) => item.postType !== 'suggestion').length,
          publishedPosts: posts.filter((item) => item.status === 'published' && item.postType !== 'suggestion').length,
          discussionGroups: discussionGroups.length,
          upcomingSessions: sessions.filter((item) => item.startsAt && new Date(item.startsAt).getTime() >= Date.now()).length,
        },
        learners,
        trainers,
        experts,
        clusters: clusterSummaries,
        products: serializedProducts,
        suggestions,
        jobs: jobs.map(withPostedByName),
        posts: posts,
        discussionGroups: discussionGroups.map((group) => ({
          id: group.id,
          title: group.title,
          status: group.status,
          course: group.course ? { id: group.course.id, title: group.course.title || 'Course' } : null,
          membersCount: Array.isArray(group.members) ? group.members.length : 0,
        })),
      },
    });
  },

  async trainerCourseOverview(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const course = await getManagedCourse(strapi, user, profile, ctx.params.id);
    if (course === false) return ctx.forbidden('You can only manage your own courses');
    if (!course) return ctx.notFound();

    const enrollments = await listCourseEnrollments(strapi, course.id);
    const assignments = await strapi.entityService.findMany('api::entrep-assignment.entrep-assignment', {
      filters: { course: course.id },
      sort: { dueAt: 'asc' },
    });
    const assignmentIds = assignments.map((assignment) => assignment.id).filter(Boolean);
    const submissions = assignmentIds.length
      ? await strapi.entityService.findMany('api::entrep-submission.entrep-submission', {
          filters: { assignment: { id: { $in: assignmentIds } } },
          populate: ['user', 'assignment'],
          sort: { submittedAt: 'desc' },
        })
      : [];
    const userIds = [...new Set([
      ...enrollments.map((enrollment) => Number(enrollment.user?.id)).filter(Boolean),
      ...submissions.map((submission) => Number(submission.user?.id)).filter(Boolean),
    ])];
    const profilesByUserId = await getProfilesByUserIds(strapi, userIds);
    const events = await strapi.entityService.findMany('api::entrep-event.entrep-event', {
      filters: { course: course.id },
      sort: { startsAt: 'asc' },
      populate: ['liveSession'],
    });
    const sessions = await strapi.entityService.findMany('api::entrep-live-session.entrep-live-session', {
      filters: { course: course.id },
      sort: { startsAt: 'desc' },
    });

    const learners = enrollments.map((enrollment) => {
      const learnerProfile = profilesByUserId.get(Number(enrollment.user?.id));
      const lessonProgress = enrollment.lessonProgress || {};
      const completedLessons = Array.isArray(enrollment.completedLessons) ? enrollment.completedLessons : [];
      return {
        enrollmentId: enrollment.id,
        userId: enrollment.user?.id,
        name: learnerProfile?.fullName || enrollment.user?.username || enrollment.user?.email || 'Learner',
        email: enrollment.user?.email || learnerProfile?.email || '',
        phone: learnerProfile?.phone || '',
        photoUrl: learnerProfile?.profilePhotoUrl || '',
        progressPct: Math.round(Number(enrollment.progressPct || 0)),
        overallScore: Math.round(Number(enrollment.overallScore || 0)),
        status: enrollment.status,
        completedAt: enrollment.completedAt,
        enrolledAt: enrollment.enrolledAt,
        certificateIssued: !!enrollment.certificateIssued,
        completedLessonsCount: completedLessons.length,
        lessonProgress,
      };
    });

    const assignmentsWithSubmissions = assignments.map((assignment) => ({
      ...assignment,
      submissions: submissions
        .filter((submission) => Number(submission.assignment?.id || submission.assignment) === Number(assignment.id))
        .map((submission) => ({
          ...submission,
          learnerName: getDisplayName(submission.user, profilesByUserId.get(Number(submission.user?.id)), 'Learner'),
          learnerPhotoUrl: profilesByUserId.get(Number(submission.user?.id))?.profilePhotoUrl || '',
        })),
    }));

    ctx.send({
      data: {
        course,
        metrics: summarizeCourseMetrics(enrollments),
        learners,
        assignments: assignmentsWithSubmissions,
        events,
        sessions,
      },
    });
  },

  async addCourseMaterial(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();

    const profile = await getProfile(strapi, user.id);
    const course = await getManagedCourse(strapi, user, profile, ctx.params.id);
    if (course === false) return ctx.forbidden('You can only manage your own courses');
    if (!course) return ctx.notFound();

    const body = ctx.request.body || {};
    const lesson = body.lesson || {};
    if (!lesson.title) return ctx.badRequest('lesson.title is required');

    let moduleId = body.moduleId ? Number(body.moduleId) : null;
    let moduleEntity = null;

    if (moduleId) {
      moduleEntity = await strapi.entityService.findOne('api::entrep-module.entrep-module', moduleId, {
        populate: ['course'],
      });
      if (!moduleEntity || Number(moduleEntity.course?.id || moduleEntity.course) !== Number(course.id)) {
        return ctx.badRequest('Selected module does not belong to this course');
      }
    } else {
      const nextOrder = Array.isArray(course.modules) ? course.modules.length : 0;
      moduleEntity = await strapi.entityService.create('api::entrep-module.entrep-module', {
        data: {
          title: body.moduleTitle || lesson.title,
          description: body.moduleDescription || '',
          order: nextOrder,
          course: course.id,
        },
      });
      moduleId = moduleEntity.id;
    }

    const existingLessons = moduleEntity?.lessons || [];
    const lessonEntity = await strapi.entityService.create('api::entrep-lesson.entrep-lesson', {
      data: {
        title: lesson.title,
        description: lesson.description,
        order: Array.isArray(existingLessons) ? existingLessons.length : 0,
        lessonType: lesson.lessonType || 'video',
        videoUrl: lesson.videoUrl || null,
        pdfUrl: lesson.pdfUrl || null,
        imageUrl: lesson.imageUrl || null,
        bodyText: lesson.bodyText || null,
        durationMin: lesson.durationMin || 0,
        module: moduleId,
      },
    });

    const updatedCourse = await strapi.entityService.findOne('api::entrep-course.entrep-course', course.id, {
      populate: { trainer: true, modules: { populate: ['lessons', 'quiz'] } },
    });

    ctx.send({ data: { course: updatedCourse, lesson: lessonEntity } });
  },

  /**
   * PATCH /entrep/courses/:id/approve – admin approval
   */
  async approveCourse(ctx) {
    const user = await resolveUser(strapi, ctx);
    if (!user) return ctx.unauthorized();
    const profile = await getProfile(strapi, user.id);
    const isAdmin = isAdminUser(user, profile);
    if (!isAdmin) return ctx.forbidden('Admin only');
    const { status = 'approved', feedback } = ctx.request.body || {};
    const updated = await strapi.entityService.update('api::entrep-course.entrep-course', ctx.params.id, {
      data: { status, rejectionFeedback: feedback || null },
    });
    ctx.send({ course: updated });
  },
}));
