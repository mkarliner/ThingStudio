Template.updateCredentialsForm.onRendered(function() {
	$('body').addClass('credentials-body');
});

Template.updateCredentialsForm.onDestroyed(function() {
	$('body').removeClass('credentials-body');
});