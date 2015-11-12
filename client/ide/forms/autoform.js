AutoForm.setDefaultTemplateForType('afCheckbox', 'mCheckbox');

Template.afCheckbox_mCheckbox.onRendered(function() {
	makeCheckboxID();
})

Template.afCheckbox_materialiseCheckbox.onRendered(function() {
	makeCheckboxID();
})
