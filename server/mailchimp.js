
var mailingLists = new MailChimpLists();

Accounts.onCreateUser(function(options, user){
	// console.log("NEWUSER: ",options, "USER", user);
	mcparams = {
		"email":  options.email,
		id: Meteor.settings.private.MailChimp.listId
	};
	
	// console.log("MCP: ", mcparams);
	if(options.profile.mailing_opt_out == false) {
		mailingLists.subscribe({
			"email": {"email": options.email},
			id: Meteor.settings.private.MailChimp.listId
		}, function(err, obj){
			console.log("MAILCHIMP: ", err, obj);
		})
	}
	return user;
});