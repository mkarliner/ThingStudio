
 mailingLists = new MailChimpLists();

var merge_vars = {
    EMAIL: '/* E-MAIL ADDRESS */',
    FNAME: '/* FIRST NAME */',
    LNAME: '/* LAST NAME */'
};

mcparams = {
	id: Meteor.settings.private.MailChimp.listId
};

 mailingLists.interestGroupings(mcparams, function(err, obj){
	console.log("GROUPS: ", err, obj, obj[0].groups);
});
 
 mailingLists.call("list", function(err, obj){
	console.log("Lists: ", err, obj.data);
    mailingLists.call("merge-vars",{id: {id: "04301b0b27"} }, function(err, obj){
   	console.log("MERGEV: ", err, obj.data[0].merge_vars);
   });
	
});



Accounts.onCreateUser(function(options, user){
	// console.log("NEWUSER: ",options, "USER", user);

	mcparams.emails = [{email: options.email}];
	// info = mailingLists.call("member-info", mcparams);
	//console.log("MCINFO: ", info)
	// console.log("MCP: ", mcparams);
	if(options.profile.mailing_opt_out == false) {
		try {
			mailingLists.subscribe({
				"email": {"email": options.email},
				id: Meteor.settings.private.MailChimp.listId,
				merge_vars: {
					groupings:[{name: 'Subscription medium', groups: ["application"], }] 
				}
			});
		}
		catch(err) {
			console.log("ERR:", err);
		}
		try {
			mailingLists.call("update-member", {
				"email": {"email": options.email},
				id: Meteor.settings.private.MailChimp.listId,
				merge_vars: {
					groupings:[{name: 'Subscription medium', groups: ["application"], }]
				}
			});
		}
		catch(err) {
			console.log("ERR:", err);
		}

	}
	return user;
});