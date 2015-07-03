Template.afArrayField.onRendered(function() {
	$('.autoform-add-item').addClass('btn-floating btn-plus')
	$('.autoform-add-item').remove('.glyphicon')
	$('.autoform-add-item').append('<i class="mdi-content-add"></i>')
});

Template.afObjectField.onRendered(function() {
	$('.autoform-remove-item').addClass('btn-floating btn-plus')
	$('.autoform-remove-item').remove('.glyphicon')
	$('.autoform-remove-item').append('<i class="mdi-content-remove"></i>')
});

