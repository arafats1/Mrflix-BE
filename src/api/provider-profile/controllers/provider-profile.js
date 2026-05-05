'use strict';

const EDUCATION_LEVEL_OPTIONS = ['Kindergarten', 'Primary', 'Secondary', 'Technical college', 'University', 'Other'];
const RELIGION_OPTIONS = ['Catholic', 'Protestant', 'Pentecostal', 'Adventist', 'Orthodox', 'Muslim', 'Hindu', 'Bahai', 'Traditional', 'Other'];

function normalizeEducationLevels(input = []) {
  const values = Array.isArray(input) ? input : [];
  return [...new Set(values.filter((level) => EDUCATION_LEVEL_OPTIONS.includes(level)))];
}

function normalizeSubjectsTaught(input = []) {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  return [...new Set(rawValues.map((value) => String(value || '').trim()).filter(Boolean))];
}

module.exports = {
  async updateMe(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();

    const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
    });

    if (!currentUser || currentUser.accountType !== 'provider') {
      return ctx.forbidden('Only provider accounts can update this profile');
    }

    const body = ctx.request.body?.data || ctx.request.body || {};
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const schoolName = typeof body.schoolName === 'string' ? body.schoolName.trim() : '';
    const religion = RELIGION_OPTIONS.includes(body.religion) ? body.religion : null;
    const educationLevels = normalizeEducationLevels(body.educationLevels);
    const educationLevelOther = typeof body.educationLevelOther === 'string' ? body.educationLevelOther.trim() : '';
    const teacherBackground = typeof body.teacherBackground === 'string' ? body.teacherBackground.trim() : '';
    const teachingExperience = typeof body.teachingExperience === 'string' ? body.teachingExperience.trim() : '';
    const subjectsTaught = normalizeSubjectsTaught(body.subjectsTaught);

    if (!fullName) return ctx.badRequest('Full name is required');

    const updateData = { fullName };

    if (currentUser.providerType === 'teacher') {
      if (!schoolName) return ctx.badRequest('School is required for teacher accounts');
      if (educationLevels.length === 0) return ctx.badRequest('Select at least one education level');
      if (educationLevels.includes('Other') && !educationLevelOther) {
        return ctx.badRequest('Enter the custom education level when selecting Other');
      }

      updateData.schoolName = schoolName;
      updateData.educationLevels = educationLevels;
      updateData.educationLevel = educationLevels[0] || null;
      updateData.educationLevelOther = educationLevels.includes('Other') ? educationLevelOther : null;
      updateData.teacherBackground = teacherBackground || null;
      updateData.teachingExperience = teachingExperience || null;
      updateData.subjectsTaught = subjectsTaught;
    }

    if (currentUser.providerType === 'religious') {
      if (!religion) return ctx.badRequest('Religion is required for religious providers');
      updateData.religion = religion;
    }

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: updateData,
    });

    ctx.body = { data: updateData };
  },

  async toggleTeacherSubscription(ctx) {
    if (!ctx.state.user) return ctx.unauthorized();

    const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: { id: ctx.state.user.id },
      select: ['id', 'isParent', 'subscribedTeacherIds'],
    });

    if (!currentUser?.isParent) {
      return ctx.forbidden('Only parent accounts can subscribe to teachers');
    }

    const teacherId = Number(ctx.params.id);
    if (!Number.isFinite(teacherId)) {
      return ctx.badRequest('Teacher not found');
    }

    const teacher = await strapi.db.query('plugin::users-permissions.user').findOne({
      where: {
        id: teacherId,
        accountType: 'provider',
        providerType: 'teacher',
      },
      select: ['id'],
    });

    if (!teacher) {
      return ctx.notFound('Teacher not found');
    }

    const currentSubscriptions = Array.isArray(currentUser.subscribedTeacherIds)
      ? currentUser.subscribedTeacherIds.map((value) => Number(value)).filter(Number.isFinite)
      : [];
    const isSubscribed = currentSubscriptions.includes(teacher.id);
    const nextSubscriptions = isSubscribed
      ? currentSubscriptions.filter((value) => value !== teacher.id)
      : [...currentSubscriptions, teacher.id];

    await strapi.db.query('plugin::users-permissions.user').update({
      where: { id: currentUser.id },
      data: { subscribedTeacherIds: nextSubscriptions },
    });

    ctx.body = {
      data: {
        teacherId: teacher.id,
        subscribed: !isSubscribed,
        subscribedTeacherIds: nextSubscriptions,
      },
    };
  },
};